import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanSkillName, humanizeSlug, MAX_IMPORT_SKILLS, nameFromPath, parseSkill, parseYamlFields, skillsFromFiles, splitFrontmatter } from "@shared/skill-parser";
import { SAVED_SKILL_LIMITS } from "@shared/skills";
import { checkImportUrl, fetchPublic, importFromFile, importFromText, importFromUrl, isPublicAddress, PUBLIC_POLICY, resolveSkillLink, skillsFromArchive, SkillImportError, type ImportPolicy } from "./agent/skill-importer";
import { zip } from "./testing/zip";

const SKILL = [
  "---",
  "name: release-notes",
  "description: Write release notes from merged pull requests. Use when the user asks for a changelog.",
  "version: 1.2.0",
  "license: MIT",
  "allowed-tools:",
  "  - Bash",
  "metadata:",
  "  author: someone",
  "---",
  "",
  "# Release notes",
  "",
  "1. List the merged pull requests.",
  "2. Group them by area.",
  "",
].join("\n");

describe("the skill parser", () => {
  it("reads frontmatter the same with \\n, \\r\\n and \\r line breaks", () => {
    const expected = {
      name: "Release notes",
      description: "Write release notes from merged pull requests. Use when the user asks for a changelog.",
      version: "1.2.0",
      body: "Write release notes from merged pull requests. Use when the user asks for a changelog.\n\n# Release notes\n\n1. List the merged pull requests.\n2. Group them by area.",
    };
    expect(parseSkill(SKILL)).toEqual(expected);
    expect(parseSkill(SKILL.replace(/\n/g, "\r\n"))).toEqual(expected);
    expect(parseSkill(SKILL.replace(/\n/g, "\r"))).toEqual(expected);
    expect(parseSkill(`﻿${SKILL}`)).toEqual(expected);
  });

  it("reads quoted, folded and literal YAML values, and skips lists and nested maps", () => {
    expect(parseYamlFields([
      `name: "Tests: \\"fast\\" first"`,
      "title: 'It''s quoted'",
      "description: >",
      "  Runs the suite",
      "  before a push.",
      "",
      "  Twice.",
      "instructions: |-",
      "  Step one.",
      "    indented",
      "  Step two.",
      "tags: [a, b]",
      "plain: a value # with a comment",
      "  that continues",
      "metadata:",
      "  version: 9",
    ].join("\n"))).toEqual({
      name: 'Tests: "fast" first',
      title: "It's quoted",
      description: "Runs the suite before a push.\nTwice.",
      instructions: "Step one.\n  indented\nStep two.",
      plain: "a value that continues",
    });
    expect(splitFrontmatter("---\n---\nBody")).toEqual({ fields: {}, body: "Body" });
    expect(splitFrontmatter("--- not frontmatter\nBody")).toBeNull();
    expect(splitFrontmatter("---\nname: unclosed\nBody")).toBeNull();
  });

  it("names a skill by its frontmatter, then its first # heading, then its file or folder", () => {
    expect(parseSkill("---\ndescription: d\n---\n# How to run tests\n\nRun pnpm test.")?.name).toBe("How to run tests");
    // The heading that became the name leaves the procedure.
    expect(parseSkill("# Deploy checklist\n\n1. Build\n2. Ship\n")).toEqual({ name: "Deploy checklist", body: "1. Build\n2. Ship" });
    expect(parseSkill("Deploy checklist\n================\n\nShip it.")).toEqual({ name: "Deploy checklist", body: "Ship it." });
    // A # inside a code block is not a title.
    expect(parseSkill("```sh\n# install\nnpm i\n```\nThen build.", "skills/build-tools/SKILL.md")?.name).toBe("Build tools");
    expect(parseSkill("Just do it.", "code_review-guide.md")?.name).toBe("Code review guide");
    // With nothing else, the first line (cut at a word).
    expect(parseSkill("Always run the linter before committing, then the tests, then describe the change.")?.name).toBe("Always run the linter before committing, then the tests,");
    expect(parseSkill("   \n\n ")).toBeNull();
    expect(parseSkill("---\nname: empty\n---\n")).toBeNull();
  });

  it("cleans names: no markdown or line breaks, slugs as words, at most 80 characters", () => {
    expect(cleanSkillName("  **Fast** `tests`:\n[docs](https://x.y) <b>now</b>  ")).toBe("Fast tests: docs now");
    expect(cleanSkillName("x".repeat(200))).toHaveLength(SAVED_SKILL_LIMITS.name);
    expect(cleanSkillName(`${"word ".repeat(30)}end`).length).toBeLessThanOrEqual(SAVED_SKILL_LIMITS.name);
    expect(humanizeSlug("frontend-design")).toBe("Frontend design");
    expect(humanizeSlug("pdf")).toBe("PDF");
    expect(humanizeSlug("claude-api")).toBe("Claude API");
    expect(humanizeSlug("Already Named")).toBe("Already Named");
    expect(nameFromPath("skills/mcp-builder/SKILL.md")).toBe("MCP builder");
    expect(nameFromPath("README.md")).toBe("");
  });

  it("reads a YAML skill file", () => {
    expect(parseSkill("name: Triage\ndescription: Sort new issues\ninstructions: |\n  Label each issue.\n\n  Close duplicates.\n", "triage.yaml")).toEqual({
      name: "Triage", description: "Sort new issues", body: "Sort new issues\n\nLabel each issue.\n\nClose duplicates.",
    });
  });

  it("keeps a long procedure whole (the save decides), so 15,000 characters arrive intact", () => {
    const long = `# Long\n\n${"Step. ".repeat(2500)}`.trim();
    const skill = parseSkill(long)!;
    expect(skill.body.length).toBe(15_000 - 1);
    expect(parseSkill(`# Huge\n\n${"x".repeat(40_000)}`)!.body).toHaveLength(40_000);
  });

  it("finds the skills in a set of files: SKILL.md first, no READMEs or hidden files, up to 10, names unique", () => {
    const files = [
      { path: "repo/README.md", text: "# Repo" },
      { path: "repo/skills/pdf/SKILL.md", text: "---\nname: pdf\ndescription: PDFs\n---\nUse it." },
      { path: "repo/skills/pdf/reference.md", text: "# Reference" },
      { path: "__MACOSX/repo/skills/pdf/._SKILL.md", text: "junk" },
      { path: "repo/.github/SKILL.md", text: "# Hidden" },
      { path: "repo/skills/other/SKILL.md", text: "---\nname: PDF\n---\nOther." },
    ];
    const { skills } = skillsFromFiles(files);
    expect(skills.map(skill => [skill.name, skill.source])).toEqual([["PDF", "repo/skills/other/SKILL.md"], ["PDF (2)", "repo/skills/pdf/SKILL.md"]]);
    // Without a SKILL.md, every markdown file but the README; the README only when it is all there is.
    expect(skillsFromFiles([{ path: "a.md", text: "# A\nDo a." }, { path: "README.md", text: "# R\nRead me." }, { path: "b.txt", text: "# B" }]).skills.map(skill => skill.name)).toEqual(["A"]);
    expect(skillsFromFiles([{ path: "README.md", text: "# Readme skill\nRead me." }]).skills.map(skill => skill.name)).toEqual(["Readme skill"]);
    const many = Array.from({ length: 14 }, (_, index) => ({ path: `s${String(index).padStart(2, "0")}/SKILL.md`, text: `# Skill ${index}\nStep.` }));
    const capped = skillsFromFiles(many);
    expect(capped.skills).toHaveLength(MAX_IMPORT_SKILLS);
    expect(capped.skipped).toBe(4);
  });
});

describe("importing from files and text", () => {
  it("reads a .zip of skill folders, only its markdown", () => {
    const archive = zip({
      "my-skills/review/SKILL.md": "---\nname: code-review\n---\nRead the diff first.",
      "my-skills/review/scripts/run.py": "print('x')",
      "my-skills/deploy/SKILL.md": "# Deploy\nShip on Fridays never.",
      "my-skills/deploy/logo.png": "\u0000\u0001binary",
    }, 8);
    expect(importFromFile("skills.zip", archive).skills.map(skill => [skill.name, skill.body])).toEqual([["Deploy", "Ship on Fridays never."], ["Code review", "Read the diff first."]]);
    expect(skillsFromArchive(archive).skills).toHaveLength(2);
    expect(() => importFromFile("broken.zip", Buffer.from("PK\u0003\u0004 not really"))).toThrow(SkillImportError);
  });

  it("reads .md, .txt and .yaml uploads and refuses other files", () => {
    expect(importFromFile("SKILL.md", Buffer.from(SKILL)).skills[0].name).toBe("Release notes");
    expect(importFromFile("notes.txt", Buffer.from("# Notes\nKeep it short.")).skills[0]).toMatchObject({ name: "Notes", body: "Keep it short." });
    expect(importFromFile("triage.yml", Buffer.from("name: Triage\ninstructions: Label it.")).skills[0]).toMatchObject({ name: "Triage", body: "Label it." });
    expect(() => importFromFile("tool.exe", Buffer.from("MZ"))).toThrow(/Upload a SKILL\.md/);
    expect(() => importFromFile("page.md", Buffer.from("<!doctype html><html></html>"))).toThrow(/web page/);
    expect(importFromText(SKILL.replace(/\n/g, "\r\n")).skills[0].name).toBe("Release notes");
  });
});

describe("importing from links", () => {
  it("turns GitHub file, folder and repository links into what to fetch", () => {
    expect(resolveSkillLink("https://github.com/acme/tools/blob/main/skills/review/SKILL.md")).toEqual({ kind: "file", url: "https://raw.githubusercontent.com/acme/tools/main/skills/review/SKILL.md", path: "skills/review/SKILL.md" });
    expect(resolveSkillLink("github.com/acme/tools/raw/v2/My%20Skill.md#L4")).toEqual({ kind: "file", url: "https://raw.githubusercontent.com/acme/tools/v2/My%20Skill.md", path: "My Skill.md" });
    expect(resolveSkillLink("https://github.com/acme/tools/tree/main/skills")).toEqual({ kind: "github-folder", owner: "acme", repo: "tools", ref: "main", path: "skills" });
    expect(resolveSkillLink("https://github.com/acme/tools.git")).toEqual({ kind: "github-folder", owner: "acme", repo: "tools", ref: null, path: "" });
    expect(resolveSkillLink("https://gist.github.com/someone/0123456789abcdef0123")).toEqual({ kind: "gist", id: "0123456789abcdef0123", user: "someone" });
    expect(resolveSkillLink("https://raw.githubusercontent.com/acme/tools/main/SKILL.md?token=x")).toEqual({ kind: "file", url: "https://raw.githubusercontent.com/acme/tools/main/SKILL.md", path: "acme/tools/main/SKILL.md" });
    expect(resolveSkillLink("https://example.org/skills/a.md")).toMatchObject({ kind: "file", url: "https://example.org/skills/a.md" });
    expect(() => resolveSkillLink("https://github.com/acme/tools/issues/4")).toThrow(/file or folder/);
  });

  it("refuses private, local and cloud metadata addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:c0a8:0101::1"]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ["8.8.8.8", "140.82.112.3", "172.32.0.1", "2606:4700::1111"]) expect(isPublicAddress(address), address).toBe(true);
    for (const link of ["http://127.0.0.1/a.md", "http://localhost/a.md", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/a.md", "http://192.168.0.1/a.md", "http://[::1]/a.md", "http://[::ffff:10.0.0.1]/a.md", "http://2130706433/a.md", "http://0x7f.0.0.1/a.md", "http://metadata.google.internal/a", "http://router/a.md"]) {
      expect(() => checkImportUrl(link), link).toThrow(/private or local address/);
    }
    expect(() => checkImportUrl("https://example.org:8443/a.md")).toThrow(/other ports/);
    expect(() => checkImportUrl("https://user:pass@example.org/a.md")).toThrow(/user name or password/);
    expect(() => checkImportUrl("file:///etc/passwd")).toThrow(/http or https/);
  });

  it("checks names when connecting: a name that resolves to a private address is refused", async () => {
    // localhost.localdomain style names resolve locally, without the network.
    await expect(fetchPublic("http://localhost.localdomain/a.md")).rejects.toMatchObject({ code: "private_address" });
    await expect(importFromUrl("http://127.0.0.1/SKILL.md")).rejects.toMatchObject({ code: "private_address" });
  });

  describe("against a server (allowed only for this test: 127.0.0.1, any port)", () => {
    let base = "";
    const server = http.createServer((req, res) => {
      if (req.url === "/SKILL.md") return res.end(SKILL);
      if (req.url === "/to-private") return res.writeHead(302, { location: "http://10.0.0.5/SKILL.md" }).end();
      if (req.url === "/to-local-name") return res.writeHead(302, { location: "http://localhost/SKILL.md" }).end();
      if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (req.url === "/hop") return res.writeHead(301, { location: "/SKILL.md" }).end();
      if (req.url === "/big") return res.end("x".repeat(2 * 1024 * 1024));
      if (req.url === "/page") return res.writeHead(200, { "content-type": "text/html" }).end("<!DOCTYPE html><html><body>Hi</body></html>");
      if (req.url === "/slow") return; // never answers
      res.writeHead(404).end();
    });
    const policy: ImportPolicy = { address: ip => ip === "127.0.0.1", port: () => true, timeoutMs: 1500 };
    beforeAll(async () => {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => { server.closeAllConnections(); server.close(); });

    it("fetches a file and follows a redirect", async () => {
      expect((await fetchPublic(`${base}/SKILL.md`, { policy })).body.toString()).toBe(SKILL);
      expect((await fetchPublic(`${base}/hop`, { policy })).body.toString()).toBe(SKILL);
    });

    it("checks every redirect again, and stops after four", async () => {
      await expect(fetchPublic(`${base}/to-private`, { policy })).rejects.toMatchObject({ code: "private_address" });
      await expect(fetchPublic(`${base}/to-local-name`, { policy })).rejects.toMatchObject({ code: "private_address" });
      await expect(fetchPublic(`${base}/loop`, { policy })).rejects.toMatchObject({ code: "redirects" });
    });

    it("stops at 1 MB and at the time limit", async () => {
      await expect(fetchPublic(`${base}/big`, { policy })).rejects.toMatchObject({ code: "too_large" });
      await expect(fetchPublic(`${base}/slow`, { policy })).rejects.toMatchObject({ code: "timeout" });
    });

    it("the public policy refuses the same server outright", async () => {
      await expect(fetchPublic(`${base}/SKILL.md`, { policy: PUBLIC_POLICY })).rejects.toBeInstanceOf(SkillImportError);
    });
  });
});
