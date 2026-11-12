import { createSpeechReader } from "@shared/voice";

export type ReadAloudHandlers = {
  signal: AbortSignal;
  /** The opening is decoded and scheduled. */
  onStart: () => void;
  /** The last scheduled piece finished. */
  onEnd: () => void;
};

/**
 * Play framed MP3 as each frame arrives. Pieces are scheduled back to back on `context`, which the
 * caller resumes inside the click so the first piece can start without another gesture. Returns
 * the frames and whether the stream ended with the completion mark (safe to replay).
 */
export async function playReadAloud(source: ReadableStream<Uint8Array> | Uint8Array[], context: AudioContext, handlers: ReadAloudHandlers): Promise<{ frames: Uint8Array[]; complete: boolean }> {
  const stream = Array.isArray(source) ? streamOf(source) : source;
  const reader = stream.getReader();
  const speech = createSpeechReader();
  const frames: Uint8Array[] = [];
  const sources: AudioBufferSourceNode[] = [];
  let nextAt = context.currentTime;
  let pending = 0;
  let started = false;
  let complete = false;
  let closed = false;

  const stopSources = () => {
    for (const node of sources) {
      try { node.stop(); } catch { /* already ended */ }
    }
  };
  handlers.signal.addEventListener("abort", stopSources);

  const pieceEnded = () => {
    pending -= 1;
    if (closed && pending === 0 && !handlers.signal.aborted) handlers.onEnd();
  };

  try {
    while (!handlers.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      const pushed = speech.push(value);
      complete = complete || pushed.done;
      for (const frame of pushed.frames) {
        if (handlers.signal.aborted) break;
        frames.push(frame);
        const copy = new ArrayBuffer(frame.byteLength);
        new Uint8Array(copy).set(frame);
        const audio = await context.decodeAudioData(copy);
        if (handlers.signal.aborted) break;
        const node = context.createBufferSource();
        node.buffer = audio;
        node.connect(context.destination);
        const startAt = Math.max(nextAt, context.currentTime + 0.03);
        node.start(startAt);
        nextAt = startAt + audio.duration;
        pending += 1;
        node.onended = pieceEnded;
        sources.push(node);
        if (!started) {
          started = true;
          handlers.onStart();
        }
      }
      if (pushed.done || handlers.signal.aborted) break;
    }
  } finally {
    handlers.signal.removeEventListener("abort", stopSources);
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  if (handlers.signal.aborted) return { frames, complete: false };
  closed = true;
  if (started && pending === 0) handlers.onEnd();
  return { frames, complete };
}

/** Cached frames, framed again so the same player can schedule them. */
function streamOf(frames: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        const header = new Uint8Array(4);
        new DataView(header.buffer).setUint32(0, frame.length);
        controller.enqueue(header);
        controller.enqueue(frame);
      }
      controller.enqueue(new Uint8Array(4));
      controller.close();
    },
  });
}
