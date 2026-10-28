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
 * raw URLs are left out (they sound like noise); link text is kept. Every pattern is bounded (no
 * line-crossing \s*, no unbounded classes), so crafted input can't make it slow.
 */
export function speakableText(markdown: string) {
  return markdown
    .slice(0, READ_ALOUD_INPUT_CHARS)
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/~~~[\s\S]*?~~~/g, " (code omitted) ")
    .replace(/^[ \t]*\|[^\n]*\|[ \t]*$/gm, "")
    .replace(/!\[[^\]\n]{0,300}\]\([^)\s]{0,2000}\)/g, "")
    .replace(/\[([^\]\n]{1,300})\]\([^)\s]{0,2000}\)/g, "$1")
    .replace(/https?:\/\/\S{1,2000}/g, "")
    .replace(/`([^`\n]{1,500})`/g, "$1")
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/[*_~]{1,3}([^*_~\n]{1,500})[*_~]{1,3}/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
