import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The page's one polite live region for milestones (run started, stopping, answer ready, run
 * failed/cancelled/interrupted, copied). Never for streamed tokens. Clearing first lets the same
 * message be announced twice in a row.
 */
export function useAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage("");
    timer.current = setTimeout(() => setMessage(text), 80);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const region = (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
  return { announce, region };
}

export type Announce = (text: string) => void;
