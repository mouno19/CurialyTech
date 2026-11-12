import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/common/IconButton";
import { refreshAccount } from "@/lib/account";
import { errorMessage, voiceApi } from "@/lib/api";
import { playReadAloud } from "@/lib/readAloud";

// One player for the page: starting an answer stops whichever one was playing.
let current: { stop: () => void } | null = null;

type Phase = "idle" | "loading" | "playing";

/**
 * Read an answer aloud. The opening starts as soon as it is spoken; the rest follows. A second
 * press stops playback. A finished answer is kept while the page is open, so the next press
 * starts at once.
 */
export function ListenButton({ taskId, text }: { taskId: string; text: string }) {
  const [state, setState] = useState<Phase>("idle");
  const phase = useRef<Phase>("idle");
  const abort = useRef<AbortController | null>(null);
  const context = useRef<AudioContext | null>(null);
  const cache = useRef<{ text: string; frames: Uint8Array[] } | null>(null);
  const handle = useRef<{ stop: () => void } | null>(null);

  const setPhase = (next: Phase) => {
    phase.current = next;
    setState(next);
  };

  const stop = () => {
    abort.current?.abort();
    abort.current = null;
    const ctx = context.current;
    context.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    setPhase("idle");
  };

  useEffect(() => () => {
    abort.current?.abort();
    if (current === handle.current) current = null;
    const ctx = context.current;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (cache.current && cache.current.text !== text) cache.current = null;
  }, [text]);

  const listen = async () => {
    if (phase.current !== "idle") return stop();
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      toast.error("This browser can't play speech.");
      return;
    }
    // Claim the button before stopping anyone else, so a second click cancels this one.
    setPhase("loading");
    if (current && current !== handle.current) current.stop();
    const mine = { stop };
    handle.current = mine;
    current = mine;
    // Resume inside the click, before any await, so the opening can play when it arrives.
    let ctx: AudioContext;
    try {
      ctx = new AudioCtx();
    } catch {
      stop();
      toast.error("This browser can't play speech.");
      return;
    }
    context.current = ctx;
    void ctx.resume();
    const controller = new AbortController();
    abort.current = controller;
    let started = false;
    let fetched = false;
    const still = () => current === mine && !controller.signal.aborted;
    try {
      const cached = cache.current?.text === text ? cache.current.frames : null;
      const source = cached ?? await voiceApi.speech(taskId, text, controller.signal);
      fetched = !cached;
      if (!still()) return;
      const played = await playReadAloud(source, ctx, {
        signal: controller.signal,
        onStart: () => {
          started = true;
          if (still()) setPhase("playing");
        },
        onEnd: () => {
          if (!still()) return;
          if (context.current === ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
          if (context.current === ctx) context.current = null;
          setPhase("idle");
        },
      });
      if (fetched) void refreshAccount();
      if (played.complete && played.frames.length && still()) cache.current = { text, frames: played.frames };
      if (!started && still()) {
        stop();
        toast.error("Couldn't read the answer aloud.");
      }
    } catch (error) {
      if (controller.signal.aborted || current !== mine) return;
      const quiet = started;
      if (fetched && started) void refreshAccount();
      stop();
      if (!quiet) toast.error("Couldn't read the answer aloud.", { description: errorMessage(error) });
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
