import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brandText } from "@shared/brand";
import { voiceCredits } from "@shared/credits";
import { speakableText } from "@shared/voice";

// Curialy Voice: what each engine is asked for, how its answers and errors come back (never with a
// provider's name), and the studio budget guard that refuses before anything is spent.

const engines = await import("./voice/engines");

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let respond: (call: Call) => Response;

beforeEach(() => {
  calls = [];
  vi.stubEnv("DEEPGRAM_API_KEY", "dg-test-key");
  vi.stubEnv("ELEVENLABS_API_KEY", "el-test-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const audio = (bytes = 4) => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "audio/mpeg" } });

describe("transcription (standard engine)", () => {
  it("sends the bytes with the key, detects the language, and returns text, duration and language", async () => {
    respond = () => json({ metadata: { duration: 12.5 }, results: { channels: [{ detected_language: "en", alternatives: [{ transcript: " Build a landing page. " }] }] } });
    const result = await engines.transcribe(Buffer.from("RIFFdata"), "audio/wav");
    expect(result).toEqual({ text: "Build a landing page.", seconds: 12.5, language: "en", byParagraph: null });
    const [call] = calls;
    expect(call.url).toMatch(/^https:\/\/api\.deepgram\.com\/v1\/listen\?/);
    const params = new URL(call.url).searchParams;
    expect(params.get("model")).toBe("nova-3");
    expect(params.get("detect_language")).toBe("true");
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Token dg-test-key");
    expect((call.init.headers as Record<string, string>)["Content-Type"]).toBe("audio/wav");
  });

  it("labels speakers on request, and uses a given language instead of detecting one", async () => {
    respond = () => json({ metadata: { duration: 3 }, results: { channels: [{ alternatives: [{ transcript: "hi there", paragraphs: { transcript: "Speaker 0: hi\\nSpeaker 1: there" } }] }] } });
    const result = await engines.transcribe(Buffer.from("x"), "audio/mpeg", { speakers: true, language: "es" });
    const params = new URL(calls[0].url).searchParams;
    expect(params.get("diarize_model")).toBe("latest");
    expect(params.get("language")).toBe("es");
    expect(params.get("detect_language")).toBeNull();
    expect(result.byParagraph).toContain("Speaker 1");
  });

  it("answers failures in its own words: out of credit, busy, unreadable audio", async () => {
    respond = () => json({ err_code: "ASR_PAYMENT_REQUIRED", err_msg: "Deepgram project does not have enough credits" }, 402);
    await expect(engines.transcribe(Buffer.from("x"), "audio/wav")).rejects.toMatchObject({ status: 503, code: "voice_unavailable" });
    respond = () => json({ err_msg: "Too many requests" }, 429);
    await expect(engines.transcribe(Buffer.from("x"), "audio/wav")).rejects.toMatchObject({ status: 429, code: "busy" });
    respond = () => json({ err_msg: "Bad Request: failed to process audio: corrupt or unsupported data" }, 400);
    const error = await engines.transcribe(Buffer.from("x"), "audio/wav").catch(failure => failure);
    expect(error).toMatchObject({ status: 422, code: "voice_rejected" });
    expect(error.message).not.toMatch(/deepgram/i);
  });

  it("refuses to run without a key", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    await expect(engines.transcribe(Buffer.from("x"), "audio/wav")).rejects.toMatchObject({ code: "not_configured" });
    expect(calls).toEqual([]);
  });
});

describe("speech", () => {
  it("speaks with the chosen standard voice, in pieces of at most 2,000 characters, as one MP3", async () => {
    respond = () => audio(5);
    const text = `${"A sentence that goes on. ".repeat(100)}The end.`;
    const speech = await engines.speakStandard(text, "orion");
    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call.url).toBe("https://api.deepgram.com/v1/speak?model=aura-2-orion-en&encoding=mp3");
      expect(JSON.parse(String(call.init.body)).text.length).toBeLessThanOrEqual(2000);
    }
    expect(speech).toMatchObject({ engine: "standard", mimeType: "audio/mpeg", characters: text.length });
    expect(speech.audio.length).toBe(10);
    // An unknown voice falls back to the default one.
    calls = [];
    await engines.speakStandard("Hi.", "nobody");
    expect(calls[0].url).toContain("aura-2-thalia-en");
  });

  it("splits at sentence ends, never past the limit", () => {
    const pieces = engines.splitForSpeech("One. Two three. Four five six.", 12);
    expect(pieces.every(piece => piece.length <= 12)).toBe(true);
    expect(pieces.join(" ")).toBe("One. Two three. Four five six.");
  });
});

describe("expressive speech (studio engine)", () => {
  const studio = (remaining: number, tts: (call: Call) => Response = () => audio(7)) => (call: Call) => {
    if (call.url.endsWith("/v1/user/subscription")) return json({ character_limit: 131_000, character_count: 131_000 - remaining });
    if (call.url.includes("/v2/voices")) return json({ voices: [{ voice_id: "plain-f", name: "Sarah - Mature", labels: { gender: "female" } }, { voice_id: "actress", name: "Lily - Velvety Actress", labels: { gender: "female" } }, { voice_id: "story-m", name: "George - Warm, Captivating Storyteller", labels: { gender: "male" } }] });
    return tts(call);
  };

  it("refuses without spending anything when the text would eat into the monthly reserve", async () => {
    respond = studio(5100);
    await expect(engines.speakExpressive("x".repeat(200), "thalia")).rejects.toMatchObject({ code: "studio_budget" });
    expect(calls.some(call => call.url.includes("/text-to-speech/"))).toBe(false);
  });

  it("acts with a performer voice of the right gender, and falls back to the previous model if needed", async () => {
    vi.resetModules();
    const fresh = await import("./voice/engines");
    respond = studio(90_000, call => (JSON.parse(String(call.init.body)).model_id === "eleven_v4" ? json({ detail: { code: "model_not_found", message: "no" } }, 404) : audio(9)));
    const speech = await fresh.speakExpressive("[whispers] Not a word.", "apollo");
    const tts = calls.filter(call => call.url.includes("/text-to-speech/"));
    expect(tts.map(call => JSON.parse(String(call.init.body)).model_id)).toEqual(["eleven_v4", "eleven_v3"]);
    expect(tts[1].url).toContain("/text-to-speech/story-m?output_format=mp3_44100_128");
    expect((tts[1].init.headers as Record<string, string>)["xi-api-key"]).toBe("el-test-key");
    expect(speech).toMatchObject({ engine: "studio", characters: 22 });
  });

  it("reports a used-up budget as such", async () => {
    vi.resetModules();
    const fresh = await import("./voice/engines");
    respond = studio(90_000, () => json({ detail: { code: "insufficient_credits", message: "ElevenLabs: not enough credits" } }, 402));
    const error = await fresh.speakExpressive("Hello.", "thalia").catch(failure => failure);
    expect(error).toMatchObject({ code: "studio_budget" });
    expect(error.message).not.toMatch(/eleven/i);
  });
});

describe("shared voice rules", () => {
  it("reads prose aloud, not code, tables, images or raw links", () => {
    const spoken = speakableText("# Done\nThe **app** builds. See [the docs](https://x.dev).\n```ts\nconst a = 1;\n```\n| a | b |\n|---|---|\n![shot](a.png) Visit https://example.com now.");
    expect(spoken).toContain("The app builds. See the docs.");
    expect(spoken).toContain("(code omitted)");
    expect(spoken).not.toMatch(/const a|\| a \||shot|https?:/);
  });

  it("stays fast on crafted input (bounded patterns, capped length)", () => {
    for (const input of ["[".repeat(100_000), "\n".repeat(100_000), "![".repeat(50_000), "*a".repeat(50_000), "|".repeat(100_000)]) {
      const started = Date.now();
      speakableText(input);
      expect(Date.now() - started).toBeLessThan(1500);
    }
  });

  it("charges a tenth of a credit per minute heard and half a credit per 1,000 characters spoken (ten times that when expressive)", () => {
    expect(voiceCredits({ seconds: 600 })).toBe(1);
    expect(voiceCredits({ characters: 2000 })).toBe(1);
    expect(voiceCredits({ characters: 2000, expressive: true })).toBe(10);
    expect(voiceCredits({ seconds: 1 })).toBe(0.01);
    expect(voiceCredits({})).toBe(0);
  });

  it("never names the voice providers, their hosts or their settings in user-facing text", () => {
    expect(brandText("Deepgram failed at https://api.deepgram.com/v1/listen with DEEPGRAM_API_KEY; ElevenLabs said no (api.elevenlabs.io, ELEVENLABS_API_KEY, model eleven_v4, aura-2-thalia-en)"))
      .not.toMatch(/deepgram|elevenlabs|eleven_v4|aura-2/i);
  });
});
