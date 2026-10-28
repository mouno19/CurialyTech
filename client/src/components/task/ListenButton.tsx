import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/common/IconButton";
import { refreshAccount } from "@/lib/account";
import { errorMessage, voiceApi } from "@/lib/api";

// One player for the page: starting an answer stops whichever one was playing.
let current: { stop: () => void } | null = null;

/** 10 ms of silence (WAV), played inside the click so Safari lets the element play once the speech arrives. */
let silence: string | null = null;
function silentClip() {
  if (silence) return silence;
  const samples = 80;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples * 2, true);
  silence = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  return silence;
}

/**
 * Read an answer aloud (its prose: code and tables are skipped server-side). The audio is fetched
 * once per answer text and kept while the page is open; a second press stops playback.
 */
export function ListenButton({ taskId, text }: { taskId: string; text: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<{ text: string; href: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const handle = useRef<{ stop: () => void } | null>(null);

  const stop = () => {
    abort.current?.abort();
    if (audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
    }
    setState("idle");
  };

  useEffect(() => () => {
    abort.current?.abort();
    audio.current?.pause();
    if (current === handle.current) current = null;
    if (url.current) URL.revokeObjectURL(url.current.href);
  }, []);

  const listen = async () => {
    if (state !== "idle") return stop();
    current?.stop();
    const mine = { stop };
    handle.current = mine;
    current = mine;
    const player = audio.current ?? new Audio();
    audio.current = player;
    player.onended = () => setState("idle");
    // Unlock playback while still inside the click (Safari refuses play() after an await otherwise).
    player.src = silentClip();
    void player.play().catch(() => undefined);
    try {
      if (url.current?.text !== text) {
        setState("loading");
        abort.current = new AbortController();
        const blob = await voiceApi.speech(taskId, text, abort.current.signal);
        void refreshAccount();
        if (url.current) URL.revokeObjectURL(url.current.href);
        url.current = { text, href: URL.createObjectURL(blob) };
      }
      // Another answer started (or this one was stopped) while the audio was on its way.
      if (current !== mine) return;
      player.src = url.current!.href;
      await player.play();
      setState("playing");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("idle");
      toast.error("Couldn't read the answer aloud.", { description: errorMessage(error) });
    }
  };

  return (
    <IconButton
      size="sm"
      label={state === "playing" ? "Stop reading aloud" : state === "loading" ? "Preparing the audio… (press to cancel)" : "Listen to the answer"}
      icon={state === "idle" ? Volume2 : Square}
      aria-pressed={state === "playing"}
      aria-busy={state === "loading" || undefined}
      onClick={() => void listen()}
    />
  );
}
