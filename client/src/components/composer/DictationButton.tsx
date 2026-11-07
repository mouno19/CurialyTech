import { Mic, Square } from "lucide-react";
import { Spinner } from "@/components/common/Spinner";
import { Tip } from "@/components/common/Tooltip";
import { useAccount } from "@/lib/account";
import { dictationSupported, useDictation } from "@/lib/useDictation";

/**
 * The microphone in a composer: records, then hands the text to `onText` (the composer puts it
 * where the cursor was). Nothing is shown when voice isn't available for the account or browser.
 * Transcription doesn't depend on a task, so it works while a run is active too.
 */
export function DictationButton({ onText, onNote, label = "Dictate", tip = "Dictate: speak your message" }: {
  onText: (text: string) => void;
  /** Progress and problems; tone "error" for ones to show next to the composer. */
  onNote: (message: string, tone?: "error") => void;
  label?: string;
  tip?: string;
}) {
  const accountInfo = useAccount().info;
  const available = Boolean(accountInfo?.voice?.available) && dictationSupported();
  const dictation = useDictation(onText, onNote);
  if (!available) return null;
  const start = () => {
    const credits = accountInfo?.credits;
    if (credits && !credits.unlimited && credits.available < 0.05) {
      onNote("You're out of credits for dictation right now. They refill with your next window, or redeem a promo code.", "error");
      return;
    }
    // A fresh recording empties the composer's status, so its outcome is announced even when it repeats.
    onNote("");
    void dictation.start();
  };
  const busy = dictation.state === "transcribing" || dictation.state === "starting";
  return (
    <>
      <Tip content={dictation.state === "recording" ? "Stop and insert the text" : dictation.state === "transcribing" ? "Turning your recording into text…" : tip}>
        <button
          type="button"
          className="toggle omni-mic"
          data-recording={dictation.state === "recording" || undefined}
          aria-label={dictation.state === "recording" ? `Stop dictation (${dictation.seconds} seconds recorded)` : label}
          aria-pressed={dictation.state === "recording"}
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          onClick={() => (dictation.state === "recording" ? dictation.stop() : dictation.state === "idle" ? start() : undefined)}
        >
          {busy ? <Spinner size={14} /> : dictation.state === "recording" ? <Square size={12} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
          <span className="toggle-label">{dictation.state === "recording" ? `${Math.floor(dictation.seconds / 60)}:${String(dictation.seconds % 60).padStart(2, "0")}` : dictation.state === "transcribing" ? "Writing…" : label}</span>
        </button>
      </Tip>
      <span className="sr-only" role="status">{dictation.state === "recording" ? "Recording. Press Stop when you're done." : dictation.state === "transcribing" ? "Turning your recording into text…" : ""}</span>
    </>
  );
}
