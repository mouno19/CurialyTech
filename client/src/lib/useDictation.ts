import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_DICTATION_SECONDS } from "@shared/voice";
import { refreshAccount } from "./account";
import { errorMessage, voiceApi } from "./api";

// Dictation: record from the microphone, then turn the recording into text on the server. The
// audio never leaves memory (no upload to the vault, nothing stored). Stops by itself at the limit.

export type DictationState = "idle" | "starting" | "recording" | "transcribing";

/** The first container this browser can record (Chrome/Firefox: WebM Opus; Safari: MP4). */
function recordingType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported(type)) return type;
  return "";
}

export const dictationSupported = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && recordingType() !== null;

export function useDictation(onText: (text: string) => void, onMessage: (message: string, tone?: "error") => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const discard = useRef(false);
  // Cleared on unmount: a microphone granted after the page moved on is switched off at once.
  const alive = useRef(true);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }, []);

  const finish = useCallback(async (blob: Blob) => {
    if (discard.current || blob.size < 512) {
      setState("idle");
      if (!discard.current) onMessage("Nothing was recorded. Hold the microphone a moment longer.", "error");
      return;
    }
    setState("transcribing");
    abort.current = new AbortController();
    try {
      // The browser's language biases the transcript. A recording in another language is still heard.
      const language = typeof navigator !== "undefined" ? navigator.language : "";
      const result = await voiceApi.transcribe(blob, language || undefined, abort.current.signal);
      void refreshAccount();
      if (result.text) {
        onText(result.text);
        onMessage(`Dictated ${Math.max(1, Math.round(result.seconds))} seconds.`);
      } else {
        onMessage("No speech was recognised. Try again a little closer to the microphone.", "error");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) onMessage(errorMessage(error, "Couldn't turn the recording into text."), "error");
    } finally {
      abort.current = null;
      setState("idle");
    }
  }, [onMessage, onText]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    const type = recordingType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) {
      onMessage("This browser can't record audio here.", "error");
      return;
    }
    setState("starting");
    discard.current = false;
    try {
      const granted = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!alive.current || discard.current) {
        granted.getTracks().forEach(track => track.stop());
        if (alive.current) setState("idle");
        return;
      }
      stream.current = granted;
    } catch (error) {
      setState("idle");
      const name = error instanceof DOMException ? error.name : "";
      onMessage(name === "NotAllowedError" ? "Microphone access is blocked. Allow it in the browser's site settings, then try again." : name === "NotFoundError" ? "No microphone was found." : "Couldn't start the microphone.", "error");
      return;
    }
    chunks.current = [];
    let media: MediaRecorder;
    try {
      media = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
    } catch {
      release();
      setState("idle");
      onMessage("This browser can't record audio here.", "error");
      return;
    }
    recorder.current = media;
    media.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
    media.onstop = () => {
      release();
      void finish(new Blob(chunks.current, { type: media.mimeType || type || "audio/webm" }));
    };
    media.start(1000);
    setSeconds(0);
    setState("recording");
    const began = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - began) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_DICTATION_SECONDS) {
        onMessage(`Recording stopped at the ${MAX_DICTATION_SECONDS / 60}-minute limit.`);
        stop();
      }
    }, 250);
  }, [finish, onMessage, release, state, stop]);

  /** Drop the recording without transcribing it. */
  const cancel = useCallback(() => {
    discard.current = true;
    abort.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    else release();
  }, [release]);

  // Leaving the page never leaves the microphone on.
  useEffect(() => () => {
    alive.current = false;
    discard.current = true;
    abort.current?.abort();
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
  }, [release]);

  return { state, seconds, start, stop, cancel };
}
