import { useReducedMotion } from "@/lib/motion";

/** Text being typed, followed by a blinking caret; under reduced motion (system or the pause switch), just the text. */
export function TypingText({ text }: { text: string }) {
  const reduce = useReducedMotion();
  return (
    <>
      {text}
      {!reduce && <span className="caret" aria-hidden="true" />}
    </>
  );
}
