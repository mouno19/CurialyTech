import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { useLocation } from "wouter";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { ArrowUp, CornerDownRight, Lock, RotateCcw, Sparkles, Users } from "lucide-react";
import { TypingText } from "@/components/common/TypingText";
import { useAnnouncer } from "@/components/task/useAnnouncer";
import { handOffTask } from "@/lib/composerDraft";
import { prefersReducedMotion, usePresence, useTypewriter } from "@/lib/motion";
import { COMPOSER_EXAMPLES, COMPOSER_SUGGESTIONS, NEXT_STEPS } from "./content";

type Mode = "solo" | "team";
export type ComposerSeed = { prompt: string; team?: boolean; nonce: number };

/**
 * The homepage composer (the reference's prompt composer). Nothing runs from here: "Assign"
 * hands the task to the workspace composer (it is waiting there after signing in, in the mode
 * picked here) and the panel explains what happens next.
 */
export function LandingComposer({ signedIn, seed }: { signedIn: boolean; seed?: ComposerSeed }) {
  const [, navigate] = useLocation();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<Mode>("solo");
  const [saved, setSaved] = useState<string | null>(null);
  const [stored, setStored] = useState(true);
  /** Shown in the panel; also announced through the page's live region (repeats included). */
  const [announcement, setAnnouncement] = useState("");
  const { announce, region } = useAnnouncer();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const typing = useTypewriter(COMPOSER_EXAMPLES, !value && !focused && saved === null);
  const panel = usePresence(saved !== null);

  useEffect(() => {
    if (!seed) return;
    setSaved(null);
    setValue(seed.prompt);
    if (seed.team !== undefined) setMode(seed.team ? "team" : "solo");
    root.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    textarea.current?.focus({ preventScroll: true });
  }, [seed]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const task = value.trim();
    // Nothing typed: hand off nothing (an example the visitor never chose is not their task).
    if (!task) {
      textarea.current?.focus();
      return;
    }
    const ok = handOffTask(task, mode === "team");
    setStored(ok);
    setSaved(task);
    const team = mode === "team" ? ", with Dev Team on" : "";
    const message = !ok ? "This browser would not store the task. Copy it before you sign in."
      : signedIn ? `Saved to your workspace composer${team}.` : `Saved for your workspace${team}. Sign in and it's waiting in the composer.`;
    setAnnouncement(message);
    announce(message);
  };
  const reset = () => {
    setSaved(null);
    setValue("");
    setAnnouncement("");
    textarea.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div id="composer" className="lp-composer" ref={root}>
      <form className="lp-composer-card" onSubmit={submit}>
        <div className="lp-composer-head">
          <span className="lp-composer-label"><span className="lp-composer-spark m-spark" aria-hidden="true" />New task</span>
          <RadioGroup.Root className="segmented lp-mode" aria-label="Who works on it" value={mode} onValueChange={next => setMode(next as Mode)} orientation="horizontal" loop>
            <RadioGroup.Item value="solo">Solo agent</RadioGroup.Item>
            <RadioGroup.Item value="team"><Users size={13} aria-hidden="true" />Dev Team</RadioGroup.Item>
          </RadioGroup.Root>
        </div>
        <label htmlFor="lp-task" className="sr-only">Describe a coding task for Curialy</label>
        <span id={hintId} className="sr-only">Press Enter to hand it over, Shift+Enter for a new line.</span>
        <div className="lp-composer-field">
          <textarea
            id="lp-task"
            ref={textarea}
            rows={3}
            value={value}
            aria-describedby={hintId}
            placeholder="Describe what you want built, fixed or explained"
            onChange={event => setValue(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
          />
          {!value && (
            <div className="lp-composer-ghost" aria-hidden="true">
              {focused || saved !== null ? "Describe what you want built, fixed or explained…" : <TypingText text={typing} />}
            </div>
          )}
        </div>
        <div className="lp-composer-bar">
          <span className="lp-composer-chip"><Lock size={13} aria-hidden="true" />Sandboxed workspace <span className="lp-composer-sep" aria-hidden="true">/</span> your repository</span>
          <button type="submit" className="lp-assign">
            Assign to Curialy
            <span className="lp-assign-icon" aria-hidden="true"><ArrowUp size={16} /></span>
          </button>
        </div>
        {panel.mounted && (
          <div className="m-collapse lp-run" data-open={panel.open || undefined}>
            <div>
              <div className="lp-run-panel panel-ink">
                <p className="lp-run-you"><span>you ›</span> {saved}</p>
                <p className="lp-run-label">What happens next</p>
                <ul className="lp-run-steps m-stagger" style={{ "--stagger": "110ms", "--m-delay": "180ms" } as CSSProperties}>
                  {NEXT_STEPS.map(step => (
                    <li key={step.label}>
                      <CornerDownRight size={14} aria-hidden="true" />
                      <span>{step.label}<span className="lp-run-detail"> · {step.detail}</span></span>
                    </li>
                  ))}
                </ul>
                <div className="lp-run-foot m-rise" style={{ "--m-delay": "640ms" } as CSSProperties}>
                  <p>
                    <Sparkles size={16} aria-hidden="true" />
                    {announcement}
                  </p>
                  <div className="lp-run-actions">
                    <button type="button" className="lp-ghost" onClick={reset}><RotateCcw size={14} aria-hidden="true" />New task</button>
                    {stored && (
                      <button type="button" className="lp-pill lp-pill-paper m-nudge" onClick={() => navigate(signedIn ? "/" : "/login")}>
                        {signedIn ? "Open it in the workspace" : "Sign in to run it"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </form>
      {region}
      <div className="lp-try">
        <span className="lp-try-label">Try</span>
        {COMPOSER_SUGGESTIONS.map(suggestion => (
          <button key={suggestion.label} type="button" className="lp-chip" onClick={() => { setSaved(null); setValue(suggestion.prompt); textarea.current?.focus(); }}>
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}
