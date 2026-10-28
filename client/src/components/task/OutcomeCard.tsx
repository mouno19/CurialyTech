import { useId, useState } from "react";
import { Check, CircleSlash, CircleX, Copy, ExternalLink, Rocket, RotateCcw, ScrollText, TriangleAlert, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { RunOutcome, StatusReason, TaskStatus } from "@shared/agent";
import { outcomeIssues, statusReasonText } from "@shared/taskStatus";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { Spinner } from "@/components/common/Spinner";
import { runEffects, scrubText, type RunView } from "@/lib/taskStream";
import { formatClock, fullDate, interruptedCause } from "./format";
import { ProgressNote } from "./Messages";
import { ListenButton } from "./ListenButton";

export type OutcomeProps = {
  view: RunView;
  /** With voice available: the answer can be read aloud. */
  listen?: { taskId: string } | null;
  /** What this run ended as; for the latest run, the page's derived status. */
  status: TaskStatus | null;
  reason: StatusReason | null;
  error: string | null;
  /** When it ended (ISO). */
  endedAt: string | null;
  outcome?: RunOutcome | null;
  /** The latest run gets the actions (Retry, View logs); earlier runs are history. */
  latest: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  retryDisabled?: string | null;
  /** A deploy run can't be retried: its action starts a new deploy instead. */
  retryAs?: "retry" | "deploy";
  onViewLogs?: () => void;
  onCopied?: (message: string) => void;
  fresh?: boolean;
};

function When({ at }: { at: string | null }) {
  const clock = formatClock(at);
  if (!at || !clock) return null;
  return <time className="outcome-time" dateTime={at} title={fullDate(at)}>{clock}</time>;
}

const ERROR_PREVIEW = 360;

function ErrorSummary({ text }: { text: string }) {
  const clean = scrubText(text).trim();
  if (clean.length <= ERROR_PREVIEW) return <p className="outcome-error">{clean}</p>;
  return (
    <details className="outcome-error-more">
      <summary className="outcome-error">{clean.slice(0, ERROR_PREVIEW).trimEnd()}… <span className="link">Show the full error</span></summary>
      <pre className="kv panel-ink" tabIndex={0}>{clean}</pre>
    </details>
  );
}

/**
 * How a run ended, scoped to that run: "Answer" only for a completed run (with its issues, if
 * any), a danger card for a failed one, what still happened for a cancelled one, and what was
 * kept for an interrupted one. Never success styling for anything but a clean completion.
 */
export function OutcomeCard({ view, listen, status, reason, error, endedAt, outcome, latest, onRetry, retrying, retryDisabled, retryAs = "retry", onViewLogs, onCopied, fresh }: OutcomeProps) {
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const deploy = retryAs === "deploy";
  const retry = latest && onRetry ? (
    <Button variant="primary" icon={deploy ? Rocket : RotateCcw} busy={retrying} aria-disabled={retryDisabled ? true : undefined} title={retryDisabled ?? (deploy ? "Start a new live preview" : undefined)} onClick={onRetry}>
      {deploy ? (retrying ? "Deploying…" : "Deploy again") : retrying ? "Retrying…" : "Retry"}
    </Button>
  ) : null;
  const common = { "aria-labelledby": titleId, "data-fresh": fresh || undefined, "data-latest": latest || undefined } as const;

  if (status === "cancelling") {
    return (
      <section className="outcome" data-tone="warning" aria-busy="true" {...common}>
        <header className="outcome-head">
          <Spinner size={15} />
          <h3 id={titleId} className="outcome-title">Stopping…</h3>
        </header>
        <p className="outcome-text">Waiting for the run to stop. Files written so far are kept; nothing is published, pushed or deployed.</p>
      </section>
    );
  }

  if (status === "completed") {
    const issues = outcomeIssues(outcome);
    const answer = view.answer;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(answer);
        setCopied(true);
        onCopied?.("Answer copied");
        setTimeout(() => setCopied(false), 1500);
      } catch {
        toast.error("Couldn't copy: the browser blocked clipboard access.");
      }
    };
    return (
      <section className="outcome" data-tone={issues.length ? "warning" : "success"} data-kind="answer" {...common}>
        <header className="outcome-head">
          {issues.length ? <TriangleAlert size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
          <h3 id={titleId} className="outcome-title" data-micro="">{issues.length ? "Completed with issues" : "Answer"}</h3>
          <When at={endedAt} />
          <span className="spacer" />
          {answer.trim() && listen && <ListenButton taskId={listen.taskId} text={answer} />}
          {answer.trim() && <IconButton size="sm" label={copied ? "Copied" : "Copy answer"} icon={copied ? Check : Copy} onClick={() => void copy()} />}
        </header>
        {issues.length > 0 && (
          <ul className="outcome-issues">
            {issues.map(issue => <li key={issue}>{issue}</li>)}
          </ul>
        )}
        <div className="outcome-body">
          {answer.trim() ? <Markdown text={answer} /> : <p className="faint">The run finished without a written answer. Its steps are in the Inspector.</p>}
        </div>
      </section>
    );
  }

  if (status === "failed") {
    return (
      <section className="outcome" data-tone="danger" {...common}>
        <header className="outcome-head">
          <CircleX size={15} aria-hidden="true" />
          <h3 id={titleId} className="outcome-title">Run failed</h3>
          <When at={endedAt} />
        </header>
        {statusReasonText(reason) && <p className="outcome-text">{statusReasonText(reason)}.</p>}
        {error ? <ErrorSummary text={error} /> : <p className="outcome-text">No error message was recorded.</p>}
        {latest && (retry || onViewLogs) && (
          <footer className="outcome-actions">
            {retry}
            {onViewLogs && <Button icon={ScrollText} onClick={onViewLogs}>View logs</Button>}
          </footer>
        )}
      </section>
    );
  }

  if (status === "cancelled") {
    const effects = runEffects(view.run);
    const title = reason === "user_cancel" || !reason ? "Cancelled by you" : statusReasonText(reason) ?? "Cancelled";
    return (
      <section className="outcome" data-tone="warning" {...common}>
        <header className="outcome-head">
          <CircleSlash size={15} aria-hidden="true" />
          <h3 id={titleId} className="outcome-title">{title}</h3>
          <When at={endedAt} />
        </header>
        <p className="outcome-text">Files written before the stop are kept in the workspace.</p>
        {effects.length > 0 && (
          <div className="outcome-effects">
            <p className="micro">Already done before the stop</p>
            <ul>
              {effects.map(effect => (
                <li key={effect.key}>
                  {effect.kind === "deploy" ? `${effect.label} (see Preview in the Inspector)` : effect.label}
                  {effect.url && effect.kind !== "deploy" && (
                    <a className="outcome-link" href={effect.url} target="_blank" rel="noopener noreferrer" aria-label={`Open on GitHub: ${effect.label}`}>
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {view.notes.length > 0 && (
          <details className="progress-notes" data-variant="partial">
            <summary>Partial output (run cancelled)</summary>
            <div className="progress-notes-body">
              {view.notes.map(note => <ProgressNote key={note.key} item={note} streaming={false} />)}
            </div>
          </details>
        )}
        {retry && <footer className="outcome-actions">{retry}</footer>}
      </section>
    );
  }

  if (status === "interrupted") {
    const clock = formatClock(endedAt);
    return (
      <section className="outcome" data-tone="warning" {...common}>
        <header className="outcome-head">
          <Unplug size={15} aria-hidden="true" />
          <h3 id={titleId} className="outcome-title">Interrupted</h3>
          <When at={endedAt} />
        </header>
        <p className="outcome-text">
          Interrupted — {interruptedCause(reason)}{clock ? ` (${clock})` : ""}. Workspace and conversation up to then were kept.
        </p>
        {retry && <footer className="outcome-actions">{retry}</footer>}
      </section>
    );
  }

  return null;
}
