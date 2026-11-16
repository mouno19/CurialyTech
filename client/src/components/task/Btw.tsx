import { CornerDownRight, Send } from "lucide-react";
import { Spinner } from "@/components/common/Spinner";

// /btw: a side question (or a quick note) to a running task, answered from its live state while
// the run goes on. Its card sits in the conversation beside the run, set apart from the agent's own
// messages: the run never stopped for it.

/** A /btw question waiting for its answer (reply set once the request answered, until the event arrives). */
export type PendingAside = { id: string; query: string; reply?: string; forwarded?: boolean };

/** The question, then the answer (or "checking"), and whether the user's words went to the agent. */
export function BtwCard({ query, reply, forwarded, fresh }: { query: string; reply?: string; forwarded?: boolean; fresh?: boolean }) {
  const waiting = reply === undefined;
  return (
    <aside className="btw-card" data-fresh={fresh || undefined} data-pending={waiting || undefined} aria-label="Side question">
      <p className="btw-q">
        <span className="btw-tag" aria-hidden="true">/btw</span>
        <span className="sr-only">You asked on the side: </span>
        <span className="btw-text">{query}</span>
      </p>
      {waiting ? (
        <p className="btw-a btw-wait" role="status"><Spinner size={12} /><span>Checking the live run…</span></p>
      ) : (
        <p className="btw-a">
          <CornerDownRight size={14} aria-hidden="true" />
          <span className="sr-only">Answer: </span>
          <span className="btw-text">{reply}</span>
        </p>
      )}
      {forwarded && <span className="chip btw-chip"><Send size={11} aria-hidden="true" />Passed to the agent for its next step</span>}
    </aside>
  );
}
