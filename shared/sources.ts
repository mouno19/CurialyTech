// Web search sources, shared by the server (dedupe, numbering per task) and the chat (citations):
// one canonical form of a URL, so a link in an answer matches the source it cites whatever its
// scheme, "www.", trailing slash, fragment or tracking parameters.

const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|ref_src|_hsenc|_hsmi)$/i;

function parse(raw: string) {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The URL to show and link: http(s) only, without credentials or tracking parameters (null: not a web URL). */
export function cleanSourceUrl(raw: string): string | null {
  const url = parse(raw);
  if (!url) return null;
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return url.toString();
}

/** The key two links to the same page share (null: not a web URL). */
export function canonicalSourceUrl(raw: string): string | null {
  const url = parse(raw);
  if (!url) return null;
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const query = url.searchParams.toString();
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.port ? `:${url.port}` : ""}${url.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
}

/** The site a source is from, as people write it: "nodejs.org", "en.wikipedia.org". */
export function sourceDomain(raw: string) {
  return parse(raw)?.hostname.toLowerCase().replace(/^www\./, "") ?? "";
}
