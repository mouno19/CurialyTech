import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { isSkillCandidate, MAX_IMPORT_SKILLS, parseSkill, skillsFromFiles, type ParsedSkill, type SkillFile } from "@shared/skill-parser";
import { unzipFiles } from "./reading";

// Skills from anywhere, on the server: a link (a GitHub file, folder or repository, a gist, any
// raw web file), pasted text, or an uploaded file (.md, .txt, .yaml or a .zip of skills), read
// into skills with the shared parser. Links are fetched only from public addresses: every address
// a name resolves to is checked when the connection is made (so a name can't switch to a private
// one between a check and the request), and again after each redirect.

export class SkillImportError extends Error {
  constructor(message: string, readonly status = 422, readonly code = "import_failed") {
    super(message);
    this.name = "SkillImportError";
  }
}

export type ImportResult = { skills: ParsedSkill[]; skipped: number };

/** One remote file at most (a skill, a folder listing, an archive). */
export const MAX_REMOTE_BYTES = 1024 * 1024;
export const REMOTE_TIMEOUT_MS = 10_000;
/** An uploaded file: a text skill, or an archive of skills (only its markdown is read). */
export const MAX_SKILL_TEXT_BYTES = 1024 * 1024;
export const MAX_SKILL_ARCHIVE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 4;
/** All the requests one link may make (a folder of skills is a listing and a file per skill). */
const IMPORT_BUDGET_MS = 25_000;
const USER_AGENT = "skill-importer/1.0";

// ---- Addresses ----

const BLOCKED = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(prefix, bits, "ipv4");
for (const [prefix, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["100::", 64]] as const) {
  BLOCKED.addSubnet(prefix, bits, "ipv6");
}

/** The IPv4 address inside an IPv6 one that carries it (mapped, compatible, NAT64, 6to4), if any. */
function embeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:(?:0:)?|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:(?:0:)?|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(lower);
  const pair = hex ?? sixToFour;
  if (!pair) return null;
  const high = parseInt(pair[1], 16);
  const low = parseInt(pair[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/**
 * Whether an address is on the public internet: not loopback, private (10/8, 172.16/12,
 * 192.168/16, fc00::/7), link-local (169.254/16, where cloud metadata services answer, and
 * fe80::/10), carrier-grade NAT, multicast, documentation or reserved space.
 */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = net.isIP(bare);
  if (!family) return false;
  if (family === 4) return !BLOCKED.check(bare, "ipv4");
  const inner = embeddedIPv4(bare);
  if (inner) return net.isIP(inner) === 4 && !BLOCKED.check(inner, "ipv4");
  return !BLOCKED.check(bare, "ipv6");
}

/**
 * Which addresses and ports links may reach: public addresses on the default ports. Tests pass
 * their own to reach a local server; nothing else changes it.
 */
export type ImportPolicy = { address: (ip: string) => boolean; port: (port: string) => boolean; timeoutMs: number };
export const PUBLIC_POLICY: ImportPolicy = { address: isPublicAddress, port: port => !port || port === "443" || port === "80", timeoutMs: REMOTE_TIMEOUT_MS };

const PRIVATE = () => new SkillImportError("That link points to a private or local address, which imports can't reach. Use a public link.", 400, "private_address");

/** A link the importer may request: http(s), no credentials, the default port, and a public host. */
export function checkImportUrl(value: string | URL, policy: ImportPolicy = PUBLIC_POLICY): URL {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new SkillImportError("That isn't a link. Paste a full address, such as a GitHub file or a raw SKILL.md.", 400, "bad_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SkillImportError("Use an http or https link.", 400, "bad_url");
  if (url.username || url.password) throw new SkillImportError("Links with a user name or password can't be imported.", 400, "bad_url");
  if (!policy.port(url.port)) throw new SkillImportError("Links on other ports can't be imported. Use a standard web address.", 400, "bad_url");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new SkillImportError("That link has no host.", 400, "bad_url");
  if (net.isIP(host)) {
    if (!policy.address(host)) throw PRIVATE();
    url.hash = "";
    return url;
  }
  const internalName = host === "localhost" || /\.(localhost|local|internal|home\.arpa|lan|intranet)$/.test(host) || (!host.includes(".") && !net.isIP(host));
  if (internalName) throw PRIVATE();
  url.hash = "";
  return url;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** dns.lookup that refuses a name when any of its addresses is not allowed (not public). */
export const guardedLookup = (policy: ImportPolicy) => (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (!addresses.length || addresses.some(entry => !policy.address(entry.address))) {
      return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: "EPRIVATE" }), "");
    }
    const wanted = options.family === 4 || options.family === 6 ? addresses.filter(entry => entry.family === options.family) : addresses;
    const usable = wanted.length ? wanted : addresses;
    if (options.all) return callback(null, usable);
    callback(null, usable[0].address, usable[0].family);
  });
};

// ---- Fetching ----

export type Fetched = { url: URL; status: number; contentType: string; body: Buffer };

function requestOnce(url: URL, deadline: number, maxBytes: number, policy: ImportPolicy): Promise<Fetched & { location?: string }> {
  return new Promise((resolve, reject) => {
    const left = Math.min(policy.timeoutMs, deadline - Date.now());
    if (left <= 0) return reject(new SkillImportError("That link took too long to answer.", 504, "timeout"));
    const lib = url.protocol === "https:" ? https : http;
    const request = lib.request(url, {
      method: "GET",
      agent: false,
      lookup: guardedLookup(policy) as never,
      headers: { "user-agent": USER_AGENT, accept: "text/markdown, text/plain, application/zip, application/json;q=0.9, */*;q=0.5", "accept-encoding": "identity" },
    });
    const timer = setTimeout(() => request.destroy(new SkillImportError("That link took too long to answer.", 504, "timeout")), left);
    request.on("error", error => {
      clearTimeout(timer);
      if (error instanceof SkillImportError) return reject(error);
      if ((error as NodeJS.ErrnoException).code === "EPRIVATE") return reject(PRIVATE());
      if ((error as NodeJS.ErrnoException).code === "ENOTFOUND") return reject(new SkillImportError(`${url.hostname} wasn't found. Check the link.`, 422, "not_found"));
      reject(new SkillImportError(`${url.hostname} couldn't be reached.`, 502, "unreachable"));
    });
    request.on("response", response => {
      const status = response.statusCode ?? 0;
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        clearTimeout(timer);
        return resolve({ url, status, contentType, body: Buffer.alloc(0), location: response.headers.location });
      }
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        request.destroy();
        clearTimeout(timer);
        return reject(new SkillImportError(`That file is larger than ${Math.round(maxBytes / 1024)} KB.`, 413, "too_large"));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new SkillImportError(`That file is larger than ${Math.round(maxBytes / 1024)} KB.`, 413, "too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        clearTimeout(timer);
        resolve({ url, status, contentType, body: Buffer.concat(chunks) });
      });
      response.on("error", () => undefined); // reported through the request
    });
    request.end();
  });
}

/** GET a public link (following up to four redirects, each checked again), at most maxBytes. */
export async function fetchPublic(target: string | URL, { deadline = Date.now() + REMOTE_TIMEOUT_MS, maxBytes = MAX_REMOTE_BYTES, policy = PUBLIC_POLICY }: { deadline?: number; maxBytes?: number; policy?: ImportPolicy } = {}): Promise<Fetched> {
  let url = checkImportUrl(target, policy);
  for (let hop = 0; ; hop++) {
    const answer = await requestOnce(url, deadline, maxBytes, policy);
    if (!answer.location) return answer;
    if (hop >= MAX_REDIRECTS) throw new SkillImportError("That link redirects too many times.", 422, "redirects");
    url = checkImportUrl(new URL(answer.location, url), policy);
  }
}

function explainStatus(fetched: Fetched) {
  const { status, url } = fetched;
  if (status === 404 || status === 410) return new SkillImportError(`Nothing was found at that link (${url.hostname} answered ${status}). Check that it is public and the path is right.`, 422, "not_found");
  if (status === 401 || status === 403) {
    if (url.hostname === "api.github.com") return new SkillImportError("GitHub is limiting folder listings right now. Link the SKILL.md file itself, or try again in a few minutes.", 429, "rate_limited");
    return new SkillImportError(`${url.hostname} didn't allow the download (${status}). Use a public link.`, 422, "forbidden");
  }
  if (status === 429) return new SkillImportError(`${url.hostname} is limiting requests right now. Try again in a minute.`, 429, "rate_limited");
  return new SkillImportError(`${url.hostname} answered ${status}. Try again, or use another link.`, 502, "remote_error");
}

async function fetchOk(target: string | URL, deadline: number) {
  const fetched = await fetchPublic(target, { deadline });
  if (fetched.status < 200 || fetched.status >= 300) throw explainStatus(fetched);
  return fetched;
}

/** The file's text, or null when the link has nothing there (404). Other failures are errors. */
async function fetchTextOrNull(target: string, deadline: number) {
  const fetched = await fetchPublic(target, { deadline });
  if (fetched.status === 404) return null;
  if (fetched.status < 200 || fetched.status >= 300) throw explainStatus(fetched);
  return decodeText(fetched.body, fetched.url);
}

// ---- Links ----

export type SkillLink =
  | { kind: "file"; url: string; path: string }
  | { kind: "github-folder"; owner: string; repo: string; ref: string | null; path: string }
  | { kind: "gist"; id: string; user: string | null };

const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const encodePath = (value: string) => value.split("/").filter(Boolean).map(segment => encodeURIComponent(segment)).join("/");
const decodeSegments = (segments: string[]) => segments.map(segment => { try { return decodeURIComponent(segment); } catch { return segment; } });

/**
 * What a link names. GitHub file pages (blob) and raw links become raw.githubusercontent.com files;
 * folder pages (tree) and repositories are folders, read as one skill (its SKILL.md) or a folder of
 * them; gists are read through their files. Any other link is fetched as a file.
 */
export function resolveSkillLink(input: string): SkillLink {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = checkImportUrl(withScheme);
  const host = url.hostname.toLowerCase();
  const segments = decodeSegments(url.pathname.split("/").filter(Boolean));
  if (host === "github.com" || host === "www.github.com") {
    const [owner, rawRepo, kind, ref, ...rest] = segments;
    const repo = rawRepo?.replace(/\.git$/i, "");
    if (!owner || !repo || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) throw new SkillImportError("Link a GitHub repository, folder or file (github.com/owner/repository/…).", 400, "bad_url");
    if (!kind) return { kind: "github-folder", owner, repo, ref: null, path: "" };
    if ((kind === "blob" || kind === "raw") && ref && rest.length) {
      return { kind: "file", url: `https://raw.githubusercontent.com/${owner}/${repo}/${encodePath(ref)}/${encodePath(rest.join("/"))}`, path: rest.join("/") };
    }
    if (kind === "tree" && ref) return { kind: "github-folder", owner, repo, ref, path: rest.join("/") };
    throw new SkillImportError("Link a file or folder of the repository (a …/blob/… or …/tree/… page), or the repository itself.", 400, "bad_url");
  }
  if (host === "gist.github.com") {
    const [first, second] = segments;
    const id = (second ?? first ?? "").replace(/\.git$/i, "");
    if (!/^[0-9a-f]{8,64}$/i.test(id)) throw new SkillImportError("Link a gist (gist.github.com/user/id).", 400, "bad_url");
    return { kind: "gist", id, user: second && first && GITHUB_NAME.test(first) ? first : null };
  }
  url.search = host === "raw.githubusercontent.com" || host === "gist.githubusercontent.com" ? "" : url.search;
  return { kind: "file", url: url.href, path: segments.join("/") };
}

// ---- Contents ----

const isZip = (bytes: Buffer) => bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
const looksBinary = (bytes: Buffer) => bytes.subarray(0, 2000).includes(0);

function decodeText(bytes: Buffer, from?: URL) {
  const head = bytes.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    const github = from && /(^|\.)github\.com$/.test(from.hostname);
    throw new SkillImportError(github ? "That link is a GitHub page, not the file. Open the file and use its Raw link, or paste the page's address as it appears for the file or folder." : "That link is a web page, not a skill file. Link the raw file (a .md or .txt address).", 422, "not_a_skill");
  }
  if (looksBinary(bytes)) throw new SkillImportError("That file isn't text. Import a SKILL.md, a markdown or text file, or a .zip of skills.", 415, "not_a_skill");
  return bytes.toString("utf8");
}

/** The skills in a zip archive: its markdown files only (SKILL.md first), at most MAX_IMPORT_SKILLS. */
export function skillsFromArchive(bytes: Buffer): ImportResult {
  const entries = unzipFiles(bytes, { accept: isSkillCandidate, maxEntry: 512 * 1024, maxTotal: 8 * 1024 * 1024, maxListed: 5000 });
  if (!entries) throw new SkillImportError("That archive couldn't be read. Upload a standard .zip (not encrypted).", 422, "bad_archive");
  const files: SkillFile[] = [...entries].filter(([, data]) => !looksBinary(data)).map(([path, data]) => ({ path, text: data.toString("utf8") }));
  return skillsFromFiles(files);
}

function oneSkill(text: string, filename: string): ImportResult {
  const skill = parseSkill(text, filename);
  return { skills: skill ? [{ ...skill, ...(filename ? { source: filename } : {}) }] : [], skipped: 0 };
}

/** A fetched file: an archive of skills, or one skill. */
function fromFetched(fetched: Fetched, path: string): ImportResult {
  if (isZip(fetched.body) || /\.zip$/i.test(path) || fetched.contentType.includes("application/zip")) {
    if (!isZip(fetched.body)) throw new SkillImportError("That link doesn't return a .zip archive.", 422, "bad_archive");
    return skillsFromArchive(fetched.body);
  }
  return oneSkill(decodeText(fetched.body, fetched.url), path.split("/").slice(-2).join("/"));
}

type ContentsEntry = { name: string; path: string; type: string; download_url?: string | null };

/** Up to `limit` tasks at a time, results in order. */
async function inTurns<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) results[index] = await run(items[index]);
  }));
  return results;
}

/**
 * A GitHub folder: the skill it is (its SKILL.md), or the skills in its sub-folders (those under a
 * skills/ folder first, as skill collections keep them), or else its markdown files.
 */
async function githubFolder(link: Extract<SkillLink, { kind: "github-folder" }>, deadline: number): Promise<ImportResult> {
  const ref = link.ref ? encodePath(link.ref) : "HEAD";
  const join = (...parts: string[]) => parts.filter(Boolean).join("/");
  const raw = (file: string) => `https://raw.githubusercontent.com/${link.owner}/${link.repo}/${ref}/${encodePath(file)}`;
  const label = (file: string) => (link.path ? file : join(link.repo, file));
  for (const name of ["SKILL.md", "skill.md"]) {
    const text = await fetchTextOrNull(raw(join(link.path, name)), deadline);
    if (text !== null) return { skills: skillsFromFiles([{ path: label(join(link.path, "SKILL.md")), text }]).skills, skipped: 0 };
  }
  const list = async (folder: string): Promise<ContentsEntry[]> => {
    const listing = await fetchOk(`https://api.github.com/repos/${link.owner}/${link.repo}/contents/${encodePath(folder)}${link.ref ? `?ref=${encodeURIComponent(link.ref)}` : ""}`, deadline);
    try {
      const parsed = JSON.parse(listing.body.toString("utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const entries = await list(link.path);
  const foldersOf = (items: ContentsEntry[], base: string) => items.filter(entry => entry.type === "dir" && isSkillCandidate(`${entry.name}/SKILL.md`)).map(entry => join(base, entry.name));
  let folders = foldersOf(entries, link.path);
  const collection = entries.find(entry => entry.type === "dir" && entry.name.toLowerCase() === "skills");
  if (collection) {
    const inner = foldersOf(await list(join(link.path, collection.name)).catch(() => []), join(link.path, collection.name));
    folders = [...inner, ...folders.filter(folder => folder !== join(link.path, collection.name))];
  }
  // A few at a time, in order, until one more skill than an import takes is found.
  let hits = 0;
  const found = await inTurns(folders.slice(0, 60), 6, async folder => {
    if (hits > MAX_IMPORT_SKILLS) return null;
    const text = await fetchTextOrNull(raw(join(folder, "SKILL.md")), deadline).catch(() => null);
    if (text === null) return null;
    hits++;
    return { path: label(join(folder, "SKILL.md")), text };
  });
  let files = found.filter((file): file is SkillFile => Boolean(file));
  if (!files.length) {
    const markdown = entries.filter(entry => entry.type === "file" && isSkillCandidate(entry.name)).slice(0, 20);
    const texts = await inTurns(markdown, 6, async entry => {
      const text = await fetchTextOrNull(raw(join(link.path, entry.name)), deadline).catch(() => null);
      return text === null ? null : { path: label(join(link.path, entry.name)), text };
    });
    files = texts.filter((file): file is SkillFile => Boolean(file));
  }
  return skillsFromFiles(files);
}

/** A gist's markdown (or text) files, read through GitHub's gist listing, or its first file when that is unavailable. */
async function gist(link: Extract<SkillLink, { kind: "gist" }>, deadline: number): Promise<ImportResult> {
  const listing = await fetchPublic(`https://api.github.com/gists/${link.id}`, { deadline });
  if (listing.status >= 200 && listing.status < 300) {
    let files: { filename: string; content?: string; truncated?: boolean; raw_url?: string }[] = [];
    try {
      files = Object.values((JSON.parse(listing.body.toString("utf8")) as { files?: Record<string, never> }).files ?? {});
    } catch {
      files = [];
    }
    const wanted = files.filter(file => /\.(md|markdown|txt)$/i.test(file.filename));
    const chosen = (wanted.length ? wanted : files).slice(0, MAX_IMPORT_SKILLS);
    const texts = await inTurns(chosen, 4, async file => {
      if (file.content && !file.truncated) return { path: file.filename, text: file.content };
      if (!file.raw_url || new URL(file.raw_url).hostname !== "gist.githubusercontent.com") return null;
      return { path: file.filename, text: decodeText((await fetchOk(file.raw_url, deadline)).body) };
    });
    const ready = texts.filter((file): file is SkillFile => Boolean(file));
    const markdown = ready.filter(file => isSkillCandidate(file.path));
    if (markdown.length) return skillsFromFiles(markdown);
    const skills = ready.flatMap(file => {
      const skill = parseSkill(file.text, file.path);
      return skill ? [{ ...skill, source: file.path }] : [];
    });
    return { skills: skills.slice(0, MAX_IMPORT_SKILLS), skipped: Math.max(0, skills.length - MAX_IMPORT_SKILLS) };
  }
  if (listing.status === 404) throw explainStatus(listing);
  if (!link.user) throw explainStatus(listing);
  const fallback = await fetchOk(`https://gist.githubusercontent.com/${link.user}/${link.id}/raw`, deadline);
  return fromFetched(fallback, "gist.md");
}

/** Skills from a link. */
export async function importFromUrl(input: string): Promise<ImportResult> {
  const deadline = Date.now() + IMPORT_BUDGET_MS;
  const link = resolveSkillLink(input);
  if (link.kind === "github-folder") return githubFolder(link, deadline);
  if (link.kind === "gist") return gist(link, deadline);
  return fromFetched(await fetchOk(link.url, deadline), link.path);
}

/** Skills from pasted text (filename: what it was called, for the name when it has no title). */
export function importFromText(content: string, filename = ""): ImportResult {
  return oneSkill(content, filename);
}

const TEXT_FILE = /\.(md|markdown|txt|ya?ml)$/i;

/** Skills from an uploaded file: .md, .markdown, .txt, .yaml or .yml (one skill), or a .zip of skills. */
export function importFromFile(filename: string, bytes: Buffer): ImportResult {
  const name = filename.replace(/\\/g, "/").split("/").at(-1) ?? "";
  if (/\.zip$/i.test(name) || isZip(bytes)) {
    if (bytes.length > MAX_SKILL_ARCHIVE_BYTES) throw new SkillImportError(`Archives are limited to ${MAX_SKILL_ARCHIVE_BYTES / 1024 / 1024} MB.`, 413, "too_large");
    return skillsFromArchive(bytes);
  }
  if (!TEXT_FILE.test(name)) throw new SkillImportError("Upload a SKILL.md, a .md, .txt or .yaml file, or a .zip of skills.", 415, "unsupported_file");
  if (bytes.length > MAX_SKILL_TEXT_BYTES) throw new SkillImportError(`Skill files are limited to ${MAX_SKILL_TEXT_BYTES / 1024 / 1024} MB.`, 413, "too_large");
  return oneSkill(decodeText(bytes), name);
}
