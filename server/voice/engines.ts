import { brandText } from "@shared/brand";
import { dictationHint, splitForSpeech, splitReadAloud, voiceSpec } from "@shared/voice";

export { splitForSpeech, splitReadAloud };

// Curialy Voice, on two engines. The standard engine (Deepgram) does almost everything: dictation,
// transcripts and narration. The studio engine (ElevenLabs) is kept for emotion and voice acting:
// only on request, only for the operator, and never past a reserve of its monthly budget.
// Keys are read from the environment at use time (DEEPGRAM_API_KEY, ELEVENLABS_API_KEY).

const STANDARD_API = "https://api.deepgram.com/v1";
const STUDIO_API = "https://api.elevenlabs.io";
/** The standard engine speaks at most this many characters per request. */
const STANDARD_MAX_CHARS = 2000;
/** Studio credits never spent by Curialy, so the account keeps a margin for the operator's own use. */
const STUDIO_RESERVE = (() => {
  const value = Number(process.env.ELEVENLABS_RESERVE);
  return Number.isFinite(value) && value >= 0 ? value : 5000;
})();

/** A caller's signal (the listener left, the run was cancelled) plus the engine's own time limit. */
const within = (ms: number, signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

export const voiceConfigured = () => Boolean(process.env.DEEPGRAM_API_KEY);
export const studioConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY);

export class VoiceError extends Error {
  constructor(message: string, readonly status = 502, readonly code = "voice_failed") {
    super(brandText(message));
  }
}

const standardKey = () => {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new VoiceError("Voice isn't set up on this server.", 503, "not_configured");
  return key;
};
const studioKey = () => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new VoiceError("The expressive voice isn't set up on this server.", 503, "not_configured");
  return key;
};

async function standardError(response: Response) {
  const body: any = await response.json().catch(() => null);
  const detail = String(body?.err_msg ?? body?.message ?? "").slice(0, 200);
  console.error(`[voice] standard engine ${response.status}: ${detail}`);
  if (response.status === 402) return new VoiceError("Voice is out of credit on this server right now. Try again later.", 503, "voice_unavailable");
  if (response.status === 429) return new VoiceError("Voice is busy right now. Try again in a moment.", 429, "busy");
  if (response.status === 400 || response.status === 413 || response.status === 422) {
    return new VoiceError(/audio|corrupt|unsupported/i.test(detail) ? "That recording couldn't be read. Try again, or use another format (mp3, wav, m4a, webm)." : `Voice couldn't process that: ${detail || "invalid input"}.`, 422, "voice_rejected");
  }
  return new VoiceError("Voice isn't available right now. Try again in a moment.", 503, "voice_unavailable");
}

async function studioError(response: Response) {
  const body: any = await response.json().catch(() => null);
  const detail = body?.detail;
  const code = String(Array.isArray(detail) ? "validation_error" : detail?.code ?? detail?.status ?? "");
  console.error(`[voice] studio engine ${response.status}: ${code} ${String(Array.isArray(detail) ? JSON.stringify(detail) : detail?.message ?? "").slice(0, 200)}`);
  if (response.status === 402 || /insufficient_credits|quota_exceeded/.test(code)) return new VoiceError("The expressive voice's monthly budget is used up. Use the standard voice.", 409, "studio_budget");
  if (response.status === 429 || /too_many_concurrent|system_busy/.test(code)) return new VoiceError("The expressive voice is busy right now. Try again in a moment.", 429, "busy");
  if (/model/.test(code)) return Object.assign(new VoiceError("That expressive model isn't available.", 422, "studio_model"), { model: true });
  if (response.status === 400 || response.status === 422) return new VoiceError("The expressive voice couldn't process that text.", 422, "voice_rejected");
  return new VoiceError("The expressive voice isn't available right now. Try again in a moment.", 503, "voice_unavailable");
}

// ---- Transcription (standard engine) ----

export type Transcript = { text: string; seconds: number; language: string | null; byParagraph: string | null };

/**
 * A recording to text. `speakers`: label who said what (meetings, interviews).
 * A known language uses that model. Otherwise Nova-3 multilingual is used (no separate detection
 * pass, and a mix of languages still transcribes). `hint` biases that toward the caller's language.
 */
export async function transcribe(audio: Buffer, contentType: string, opts: { language?: string; hint?: string; speakers?: boolean; signal?: AbortSignal } = {}): Promise<Transcript> {
  const params = new URLSearchParams({ model: "nova-3", smart_format: "true", punctuate: "true" });
  const requested = (opts.language ?? "").trim();
  const monolingual = Boolean(requested && requested !== "multi" && /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$/.test(requested));
  if (monolingual) params.set("language", requested);
  else {
    params.set("language", "multi");
    const hint = dictationHint(opts.hint);
    if (hint) params.append("language_hint", hint);
  }
  if (opts.speakers) {
    params.set("diarize_model", "latest");
    params.set("paragraphs", "true");
  }
  // Read before the request: a missing key is "not set up", not "not reachable".
  const key = standardKey();
  let response: Response;
  try {
    response = await fetch(`${STANDARD_API}/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": contentType || "application/octet-stream" },
      body: new Uint8Array(audio),
      signal: within(180_000, opts.signal),
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    throw new VoiceError("Voice isn't reachable right now. Try again in a moment.", 503, "voice_unavailable");
  }
  if (!response.ok) throw await standardError(response);
  const data: any = await response.json();
  const channel = data?.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  const languages = alternative?.languages;
  const heard = typeof channel?.detected_language === "string" && channel.detected_language
    ? channel.detected_language
    : Array.isArray(languages) && typeof languages[0] === "string" ? languages[0] : monolingual ? requested : null;
  return {
    text: String(alternative?.transcript ?? "").trim(),
    seconds: Number(data?.metadata?.duration) || 0,
    language: heard,
    byParagraph: String(alternative?.paragraphs?.transcript ?? "").trim() || null,
  };
}

// ---- Speech ----

export type Speech = { audio: Buffer; mimeType: "audio/mpeg"; characters: number; engine: "standard" | "studio" };

async function synthesize(piece: string, voiceId: string, key: string, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${STANDARD_API}/speak?model=aura-2-${voiceId}-en&encoding=mp3`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: piece }),
      signal: within(90_000, signal),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new VoiceError("Voice isn't reachable right now. Try again in a moment.", 503, "voice_unavailable");
  }
  if (!response.ok) throw await standardError(response);
  return Buffer.from(await response.arrayBuffer());
}

/** Natural narration (the default for all speech). One MP3, for a file the user keeps. */
export async function speakStandard(text: string, voiceId?: string, signal?: AbortSignal): Promise<Speech> {
  const voice = voiceSpec(voiceId);
  const key = standardKey();
  const parts: Buffer[] = [];
  for (const piece of splitForSpeech(text, STANDARD_MAX_CHARS)) parts.push(await synthesize(piece, voice.id, key, signal));
  return { audio: Buffer.concat(parts), mimeType: "audio/mpeg", characters: text.length, engine: "standard" };
}

/**
 * Read an answer aloud, one piece at a time. The first piece is the opening, so the caller can
 * play it while the rest is prepared. Each yielded buffer is one complete MP3.
 */
export async function* speakReadAloud(text: string, voiceId?: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
  const voice = voiceSpec(voiceId);
  const key = standardKey();
  for (const piece of splitReadAloud(text, STANDARD_MAX_CHARS)) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    yield await synthesize(piece, voice.id, key, signal);
  }
}

// ---- Studio: voices and budget (cached; both lookups are free) ----

type StudioVoice = { id: string; name: string; gender: string };
let studioVoices: { at: number; voices: StudioVoice[] } | null = null;
let studioBudget: { at: number; remaining: number } | null = null;

async function studioVoiceFor(gender: "female" | "male") {
  if (!studioVoices || Date.now() - studioVoices.at > 3_600_000) {
    const response = await fetch(`${STUDIO_API}/v2/voices?page_size=100&include_total_count=false`, { headers: { "xi-api-key": studioKey() }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw await studioError(response);
    const data: any = await response.json();
    studioVoices = { at: Date.now(), voices: (data?.voices ?? []).map((voice: any) => ({ id: String(voice.voice_id), name: String(voice.name ?? ""), gender: String(voice.labels?.gender ?? "") })) };
  }
  const voices = studioVoices.voices;
  // Voices described as performers or storytellers act best; any voice of the gender, else any voice.
  const acting = /actress|actor|storyteller|narrat|warrior|velvet|captivating/i;
  return voices.find(voice => voice.gender === gender && acting.test(voice.name)) ?? voices.find(voice => voice.gender === gender) ?? voices[0] ?? null;
}

/** Studio credits left this month (characters), cached for two minutes. */
export async function studioRemaining() {
  if (studioBudget && Date.now() - studioBudget.at < 120_000) return studioBudget.remaining;
  const response = await fetch(`${STUDIO_API}/v1/user/subscription`, { headers: { "xi-api-key": studioKey() }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw await studioError(response);
  const data: any = await response.json();
  const remaining = Math.max(0, Number(data?.character_limit ?? 0) - Number(data?.character_count ?? 0));
  studioBudget = { at: Date.now(), remaining };
  return remaining;
}

/**
 * Emotion and voice acting (audio tags such as [whispers] or [laughs] work). Refuses, without
 * spending anything, when the text would eat into the reserve of the monthly budget.
 */
// One expressive request at a time: the budget check below must see what the previous one spent.
let studioQueue: Promise<unknown> = Promise.resolve();

export function speakExpressive(text: string, voiceId?: string, signal?: AbortSignal): Promise<Speech> {
  const run = studioQueue.catch(() => undefined).then(() => speakExpressiveNow(text, voiceId, signal));
  studioQueue = run;
  return run;
}

async function speakExpressiveNow(text: string, voiceId?: string, signal?: AbortSignal): Promise<Speech> {
  const key = studioKey();
  const remaining = await studioRemaining();
  if (remaining - text.length < STUDIO_RESERVE) throw new VoiceError("The expressive voice's budget for this month is nearly used up. Use the standard voice.", 409, "studio_budget");
  const voice = await studioVoiceFor(voiceSpec(voiceId).gender);
  if (!voice) throw new VoiceError("No expressive voice is available.", 503, "voice_unavailable");
  for (const model of ["eleven_v4", "eleven_v3"]) {
    let response: Response;
    try {
      response = await fetch(`${STUDIO_API}/v1/text-to-speech/${encodeURIComponent(voice.id)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.45, similarity_boost: 0.75 } }),
        signal: within(120_000, signal),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new VoiceError("The expressive voice isn't reachable right now. Try again in a moment.", 503, "voice_unavailable");
    }
    if (response.ok) {
      studioBudget = studioBudget ? { at: studioBudget.at, remaining: Math.max(0, studioBudget.remaining - text.length) } : null;
      return { audio: Buffer.from(await response.arrayBuffer()), mimeType: "audio/mpeg", characters: text.length, engine: "studio" };
    }
    const error = await studioError(response);
    if ((error as VoiceError & { model?: boolean }).model && model !== "eleven_v3") continue;
    throw error;
  }
  throw new VoiceError("The expressive voice isn't available right now.", 503, "voice_unavailable");
}

// ---- Health (free calls) ----

export async function probeVoice() {
  const started = Date.now();
  if (!voiceConfigured()) return { ok: false, latencyMs: 0, detail: "Not configured", configured: false };
  try {
    const response = await fetch(`${STANDARD_API}/projects`, { headers: { Authorization: `Token ${standardKey()}` }, signal: AbortSignal.timeout(8000) });
    return { ok: response.ok, latencyMs: Date.now() - started, detail: response.ok ? "Ready: dictation, transcripts and narration" : `Not available (${response.status})`, configured: true };
  } catch {
    return { ok: false, latencyMs: Date.now() - started, detail: "Not reachable", configured: true };
  }
}

export async function probeStudio() {
  const started = Date.now();
  if (!studioConfigured()) return { ok: false, latencyMs: 0, detail: "Not configured", configured: false };
  try {
    const remaining = await studioRemaining();
    return { ok: true, latencyMs: Date.now() - started, detail: `Ready for expressive speech · ${remaining.toLocaleString("en-US")} characters left this month`, configured: true };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: error instanceof Error ? error.message : "Not available", configured: true };
  }
}
