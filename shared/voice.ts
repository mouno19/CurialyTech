// Curialy Voice: the voices, styles and limits the agent tools and the UI share. No provider names:
// the server maps these ids to its engines privately (server/voice/engines.ts).

/** standard: natural narration (the default for everything). expressive: emotion and voice acting (operator only). */
export type VoiceStyle = "standard" | "expressive";

export type VoiceSpec = { id: string; label: string; gender: "female" | "male"; description: string };

export const VOICES: VoiceSpec[] = [
  { id: "thalia", label: "Thalia", gender: "female", description: "clear, confident (American English)" },
  { id: "andromeda", label: "Andromeda", gender: "female", description: "warm, casual (American English)" },
  { id: "helena", label: "Helena", gender: "female", description: "friendly, caring (American English)" },
  { id: "apollo", label: "Apollo", gender: "male", description: "confident, comfortable (American English)" },
  { id: "arcas", label: "Arcas", gender: "male", description: "natural, smooth (American English)" },
  { id: "orion", label: "Orion", gender: "male", description: "approachable, calm (American English)" },
];

export const DEFAULT_VOICE = "thalia";
export const voiceSpec = (id: string | undefined) => VOICES.find(voice => voice.id === id) ?? VOICES[0];

/** Dictation in the composer: one recording at a time, up to five minutes. */
export const MAX_DICTATION_SECONDS = 300;
export const MAX_DICTATION_BYTES = 6 * 1024 * 1024;
/**
 * The longest a recording of this many bytes could be (speech-grade Opus at 16 kbps): credits for
 * that much are needed up front, so a deliberately low bit rate can't buy hours for a few seconds' price.
 */
export const worstCaseSeconds = (bytes: number) => Math.ceil(bytes / 2000);
/** Text accepted for reading aloud (only the first READ_ALOUD_MAX_CHARS of its prose are spoken). */
export const READ_ALOUD_INPUT_CHARS = 20_000;
/** One generate_speech call. */
export const MAX_SPEECH_CHARS = 5000;
/** Expressive speech spends a scarce budget: shorter pieces. */
export const MAX_EXPRESSIVE_CHARS = 2500;
/** Reading an answer aloud. */
export const READ_ALOUD_MAX_CHARS = 6000;

/**
 * What is worth speaking in a Markdown answer: prose and list items. Code blocks, tables, images and
 * raw URLs are left out (they sound like noise, and a placeholder such as "code omitted" would be
 * read aloud); link text and short inline names are kept. Every pattern is bounded (no
 * line-crossing \s*, no unbounded classes), so crafted input can't make it slow.
 */
export function speakableText(markdown: string) {
  return markdown
    .slice(0, READ_ALOUD_INPUT_CHARS)
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n")
    .replace(/^[ \t]*\|[^\n]*\|[ \t]*$/gm, "")
    .replace(/!\[[^\]\n]{0,300}\]\([^)\s]{0,2000}\)/g, "")
    .replace(/\[([^\]\n]{1,300})\]\([^)\s]{0,2000}\)/g, "$1")
    .replace(/https?:\/\/\S{1,2000}/g, "")
    .replace(/`[^`\n]{81,500}`/g, "")
    .replace(/`([^`\n]{1,80})`/g, "$1")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]*/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "")
    .replace(/[*_~]{1,3}([^*_~\n]{1,500})[*_~]{1,3}/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One narration request. Longer answers are spoken in pieces of this size. */
export const SPEECH_PIECE_CHARS = 2000;
/**
 * The opening of a read-aloud: enough speech that the next piece can be prepared while it plays,
 * and short enough that the first sound doesn't wait on the rest of the answer.
 */
const READ_ALOUD_OPENING_MIN = 180;
const READ_ALOUD_OPENING_MAX = 320;

/** Pieces of at most `max` characters, split at sentence ends (else at spaces). */
export function splitForSpeech(text: string, max = SPEECH_PIECE_CHARS) {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "), window.lastIndexOf("\n"));
    const at = cut > max * 0.4 ? cut + 1 : window.lastIndexOf(" ") > max * 0.4 ? window.lastIndexOf(" ") : max;
    const piece = rest.slice(0, at).trim();
    if (!piece) break;
    pieces.push(piece);
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Where the opening of a read-aloud ends (an index into `text`, which is already trimmed). */
function openingCut(text: string) {
  if (text.length <= READ_ALOUD_OPENING_MAX) return text.length;
  const window = text.slice(0, READ_ALOUD_OPENING_MAX);
  let end = 0;
  for (;;) {
    let next = -1;
    for (const token of [". ", "! ", "? ", "\n"]) {
      const found = window.indexOf(token, end);
      if (found >= 0 && (next < 0 || found < next)) next = found;
    }
    if (next < 0) break;
    end = next + 1;
    if (end >= READ_ALOUD_OPENING_MIN) return end;
  }
  const space = window.lastIndexOf(" ", READ_ALOUD_OPENING_MIN);
  if (space >= READ_ALOUD_OPENING_MIN - 40) return space;
  return READ_ALOUD_OPENING_MIN;
}

/**
 * Read-aloud pieces: a short opening (so playback can start), then pieces of at most `max`.
 * A short answer is one piece.
 */
export function splitReadAloud(text: string, max = SPEECH_PIECE_CHARS) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const at = openingCut(trimmed);
  const opening = trimmed.slice(0, at).trim();
  const rest = trimmed.slice(at).trim();
  if (!opening) return splitForSpeech(rest, max);
  if (!rest) return [opening];
  return [opening, ...splitForSpeech(rest, max)];
}

/**
 * Nova-3 multilingual hints. A code outside this list is rejected by the engine, so anything else
 * is dropped and the recording is still transcribed (the hint only biases, it doesn't restrict).
 */
const DICTATION_HINTS = new Set([
  "af", "ar", "be", "bn", "bs", "bg", "ca", "zh-HK", "zh", "zh-CN", "zh-Hans", "hr", "cs", "da", "nl",
  "en", "en-US", "en-GB", "en-AU", "en-NZ", "en-IN", "en-CA", "et", "fi", "nl-BE", "fr", "gl", "de", "el",
  "gu", "he", "hi", "hu", "id", "it", "ja", "kn", "ko", "lv", "lt", "mk", "ms", "mr", "no", "fa", "pl",
  "pt", "ro", "ru", "sr", "sk", "sl", "es", "sv", "tl", "ta", "te", "th", "tr", "uk", "vi", "xh", "zu",
]);

/**
 * A browser or caller language (BCP-47, underscores allowed) as a Nova-3 hint. Regional tags the
 * multilingual model doesn't list fall back to their language (`pt-BR` → `pt`). Unknown languages
 * return null.
 */
export function dictationHint(input: string | null | undefined): string | null {
  if (!input) return null;
  const parts = input.trim().replace(/_/g, "-").split("-").filter(Boolean).slice(0, 3);
  if (!/^[A-Za-z]{2,3}$/.test(parts[0] ?? "")) return null;
  const primary = parts[0].toLowerCase();
  const script = parts.slice(1).find(part => /^[A-Za-z]{4}$/.test(part));
  const region = parts.slice(1).find(part => /^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part));
  const scriptTag = script ? script[0].toUpperCase() + script.slice(1).toLowerCase() : "";
  const regionTag = region ? (/^\d{3}$/.test(region) ? region : region.toUpperCase()) : "";
  const candidates = [
    scriptTag && regionTag ? `${primary}-${scriptTag}-${regionTag}` : "",
    regionTag ? `${primary}-${regionTag}` : "",
    scriptTag ? `${primary}-${scriptTag}` : "",
    primary,
  ];
  return candidates.find(code => code && DICTATION_HINTS.has(code)) ?? null;
}

/** Read-aloud audio: a 4-byte big-endian length, then that many MP3 bytes, ending with a length of 0. */
export const SPEECH_MEDIA_TYPE = "application/vnd.curialy.speech";
const MAX_SPEECH_FRAME = 2_000_000;

export type SpeechPush = { frames: Uint8Array[]; done: boolean };

/**
 * Incremental reader for a read-aloud body. Frames may arrive split across chunks. A length of 0
 * marks a complete recording (safe to replay). An absurd length throws, rather than buffering it.
 */
export function createSpeechReader() {
  let pending = new Uint8Array(0);
  return {
    push(chunk: Uint8Array): SpeechPush {
      if (chunk.length) {
        const next = new Uint8Array(pending.length + chunk.length);
        next.set(pending);
        next.set(chunk, pending.length);
        pending = next;
      }
      const frames: Uint8Array[] = [];
      let done = false;
      let offset = 0;
      const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
      while (pending.length - offset >= 4) {
        const length = view.getUint32(offset);
        if (length === 0) {
          offset += 4;
          done = true;
          break;
        }
        if (length > MAX_SPEECH_FRAME) {
          pending = new Uint8Array(0);
          throw new Error("The audio was cut off.");
        }
        if (pending.length - offset - 4 < length) break;
        offset += 4;
        frames.push(pending.slice(offset, offset + length));
        offset += length;
      }
      pending = offset ? pending.slice(offset) : pending;
      return { frames, done };
    },
  };
}
