// One cloud browser session for the whole run. Credentials come only from the environment
// (BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID); they and the connect URL (which embeds a signing
// key) are never printed or written: every message that leaves this module goes through redact().
const API = "https://api.browserbase.com/v1";

export function credentialsFromEnv(env = process.env) {
  const apiKey = (env.BROWSERBASE_API_KEY ?? "").trim();
  const projectId = (env.BROWSERBASE_PROJECT_ID ?? "").trim();
  return apiKey && projectId ? { apiKey, projectId } : null;
}

/** Removes credential values, connect URLs and signed query parameters from any text. */
export function makeRedactor(secrets = []) {
  const values = secrets.filter(value => typeof value === "string" && value.length >= 6).sort((a, b) => b.length - a.length);
  return text => {
    let out = String(text ?? "");
    for (const value of values) out = out.split(value).join("***");
    return out
      .replace(/\b(wss?|https?):\/\/connect\.[^\s"'<>]+/gi, "$1://***")
      .replace(/([?&](?:signingKey|apiKey|api_key|key|sig|signature)=)[^&\s"'<>]+/gi, "$1***");
  };
}

async function call(path, creds, body, redact) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "X-BB-API-Key": creds.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`Browserbase ${path} unreachable: ${redact(error instanceof Error ? error.message : error)}`);
  }
  const text = await response.text().catch(() => "");
  return { ok: response.ok, status: response.status, text: redact(text), json: () => JSON.parse(text) };
}

/**
 * POST /v1/sessions. `timeout` (seconds) keeps a long run alive past the project default; if the
 * plan refuses it, the session is created again with the project default (and the caller is told).
 */
export async function createSession(creds, { width, height, timeout }, redact) {
  const body = { projectId: creds.projectId, browserSettings: { viewport: { width, height } } };
  let result = await call("/sessions", creds, timeout ? { ...body, timeout } : body, redact);
  let usedTimeout = timeout ?? null;
  if (!result.ok && timeout && (result.status === 400 || result.status === 422)) {
    result = await call("/sessions", creds, body, redact);
    usedTimeout = null;
  }
  if (!result.ok) throw new Error(`Browserbase refused the session (HTTP ${result.status}): ${result.text.slice(0, 300)}`);
  let data;
  try {
    data = result.json();
  } catch {
    throw new Error("Browserbase answered the session request with something that is not JSON.");
  }
  if (!data?.id || !data?.connectUrl) throw new Error("Browserbase answered without a session id or connect URL.");
  return { id: String(data.id), connectUrl: String(data.connectUrl), timeout: usedTimeout };
}

/** POST /v1/sessions/:id {status: "REQUEST_RELEASE"}: frees the browser (and stops billing) now. */
export async function releaseSession(creds, sessionId, redact) {
  const result = await call(`/sessions/${encodeURIComponent(sessionId)}`, creds, { projectId: creds.projectId, status: "REQUEST_RELEASE" }, redact);
  if (!result.ok) throw new Error(`Browserbase did not release session ${sessionId} (HTTP ${result.status}): ${result.text.slice(0, 200)}`);
}
