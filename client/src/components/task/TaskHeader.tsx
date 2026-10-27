import { useEffect, useRef, useState, type ReactNode } from "react";
import { Cpu } from "lucide-react";
import { getModel, type AgentTaskSummary, type RunOutcome, type StatusReason, type TaskStatus } from "@shared/agent";
import { statusReasonText } from "@shared/taskStatus";
import { GitHubMark } from "@/components/common/GitHubMark";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatClock, fullDate } from "./format";

type Props = {
  task: AgentTaskSummary | null;
  status: TaskStatus | null;
  reason: StatusReason | null;
  outcome?: RunOutcome | null;
  /** When the current status was reached (shown for interrupted, failed and cancelled tasks). */
  changedAt: string | null;
  model: string | null;
  /** Extra controls (e.g. linking a repository). */
  children?: ReactNode;
};

const EXPLAINED: TaskStatus[] = ["interrupted", "failed", "cancelled"];

/** The task as a whole: the full prompt (clamped, expandable), status with why and when, model, repository. */
export function TaskHeader({ task, status, reason, outcome, changedAt, model, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const element = title.current;
    if (!element) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [task?.prompt, expanded]);

  const modelLabel = model ? getModel(model)?.label ?? model : null;
  const reasonText = status && EXPLAINED.includes(status) ? statusReasonText(reason) : null;
  const clock = status && EXPLAINED.includes(status) ? formatClock(changedAt) : null;
  const repo = task?.githubRepo;
  const repoText = repo ? `${repo}${task?.githubMode === "linked" && task.githubBranch ? ` · ${task.githubBranch}` : ""}` : null;

  return (
    <header className="task-head">
      {task ? (
        <h2 id="task-prompt" ref={title} className="task-title" data-expanded={expanded || undefined}>{task.prompt}</h2>
      ) : (
        <div className="task-title-loading" aria-hidden="true"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>
      )}
      {task && (clamped || expanded) && (
        <button type="button" className="btn link sm task-title-toggle" aria-expanded={expanded} aria-controls="task-prompt" onClick={() => setExpanded(value => !value)}>
          {expanded ? "Show less" : "Show the full prompt"}
        </button>
      )}
      <div className="task-meta">
        {status ? <StatusBadge status={status} outcome={outcome} reason={reason} /> : <span className="skeleton task-badge-skeleton" aria-hidden="true" />}
        {(reasonText || clock) && (
          <span className="task-reason">
            {reasonText}
            {reasonText && clock ? " · " : null}
            {clock && changedAt && <time dateTime={changedAt} title={fullDate(changedAt)}>{clock}</time>}
          </span>
        )}
        {modelLabel && (
          <span className="chip" title={`Model: ${modelLabel}`}>
            <Cpu size={12} aria-hidden="true" />
            <span className="truncate">{modelLabel}</span>
          </span>
        )}
        {repoText && (task?.githubRepoUrl ? (
          <a className="chip mono task-repo" href={task.githubRepoUrl} target="_blank" rel="noopener noreferrer" title={`${task.githubMode === "linked" ? "Linked repository" : "Exported to"} ${repoText}`}>
            <GitHubMark size={12} />
            <span className="truncate">{repoText}</span>
          </a>
        ) : (
          <span className="chip mono task-repo" title={repoText}>
            <GitHubMark size={12} />
            <span className="truncate">{repoText}</span>
          </span>
        ))}
        {children}
      </div>
    </header>
  );
}
