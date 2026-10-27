import { memo, type ReactNode, type RefObject, type Ref } from "react";
import type { AgentTaskSummary, RunOutcome, StatusReason, TaskStatus } from "@shared/agent";
import { isActiveStatus } from "@shared/taskStatus";
import { Attachments } from "@/components/Attachments";
import { LiveBrowser } from "@/components/LiveBrowser";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { HandoffCard } from "@/components/deck/Team";
import { PHASE_SHORT } from "@/components/deck/Timeline";
import { PHASES } from "@shared/agent";
import { isReplayed, resolveAnswer, runError, type BrowserState, type RunView, type StreamState, type TimelineItem, type UserAttachment } from "@/lib/taskStream";
import type { StickToBottom } from "@/lib/useStickToBottom";
import { JumpToLatest } from "./JumpToLatest";
import { ProgressNote, ProgressNotes, RunDivider, UserBubble } from "./Messages";
import { OutcomeCard } from "./OutcomeCard";

export type PendingMessage = { clientMessageId: string; text: string; attachments: UserAttachment[] };

/** What the latest run's outcome card needs from the page (derived status, stored row). */
export type LatestOutcome = {
  status: TaskStatus | null;
  reason: StatusReason | null;
  error: string | null;
  endedAt: string | null;
  outcome: RunOutcome | null;
  rowAnswer: string | null;
};

type Actions = {
  onRetry: () => void;
  retrying: boolean;
  retryDisabled: string | null;
  retryAs?: "retry" | "deploy";
  onViewLogs: () => void;
  onCopied: (message: string) => void;
};

type Props = Actions & {
  taskId: string;
  task: AgentTaskSummary | null;
  state: StreamState;
  views: RunView[];
  latest: LatestOutcome;
  /** The derived task status is active. */
  active: boolean;
  /** Active and the stream is connected: things may still grow and move. */
  streaming: boolean;
  pending: PendingMessage[];
  header: ReactNode;
  composer: ReactNode;
  scrollRef: Ref<HTMLDivElement>;
  stick: StickToBottom;
};

const isFresh = (seq: number, mark: number | null) => mark !== null && seq > mark;

function Card({ item, taskId, browsers, taskActive, streamConnected, streaming, mark }: { item: TimelineItem; taskId: string; browsers: Record<string, BrowserState>; taskActive: boolean; streamConnected: boolean; streaming: boolean; mark: number | null }) {
  const fresh = isFresh(item.seq, mark) || undefined;
  switch (item.kind) {
    case "text":
      return <ProgressNote item={item} streaming={streaming} fresh={fresh} />;
    case "user":
      return <UserBubble text={item.text} attachments={item.attachments} ts={item.ts} fresh={fresh} />;
    case "browser":
      return browsers[item.sessionId] ? <div className="convo-card" data-fresh={fresh}><LiveBrowser taskId={taskId} browser={browsers[item.sessionId]} taskActive={taskActive} streamConnected={streamConnected} /></div> : null;
    case "attachments":
      return <div className="convo-card" data-fresh={fresh}><Attachments taskId={taskId} files={item.files} auto={item.auto} more={item.more} skipped={item.skipped} generated={item.generated} partial={item.partial} /></div>;
    case "handoff":
      return <div className="convo-card" data-fresh={fresh}><HandoffCard item={item} /></div>;
    default:
      return null;
  }
}

type BlockProps = Actions & {
  view: RunView;
  isLatest: boolean;
  latest: LatestOutcome;
  taskId: string;
  browsers: Record<string, BrowserState>;
  taskActive: boolean;
  streamConnected: boolean;
  streaming: boolean;
  mark: number | null;
};

/** One run: what was asked, what happened (live, or folded into notes once over), and how it ended. */
const RunBlock = memo(function RunBlock(props: BlockProps) {
  const { view, isLatest, latest, taskId, browsers, taskActive, streamConnected, streaming, mark } = props;
  const run = view.run;
  // A run whose log has its done event is over for good (a new run starts with its own run_start).
  // Otherwise the latest run follows the page's status, and an earlier one never finished.
  const status = run.end ? run.end.status : isLatest ? latest.status : "interrupted";
  const over = status !== null && !isActiveStatus(status);
  // While a follow-up or retry is starting, the previous run keeps its card but offers no actions.
  const actionable = isLatest && !taskActive;
  const live = isLatest && !run.end;
  const cardProps = { taskId, browsers, taskActive: live && taskActive, streamConnected, streaming: live && streaming, mark };

  if (!over) {
    return (
      <div className="run-block" data-run={run.index}>
        {view.divider && <RunDivider divider={view.divider} />}
        {view.user && <UserBubble text={view.user.text} attachments={view.user.attachments} ts={view.user.ts} fresh={isFresh(view.user.seq, mark)} />}
        {view.entries.map(item => <Card key={item.key} item={item} {...cardProps} />)}
        {status === "cancelling" && <OutcomeCard view={view} status="cancelling" reason={latest.reason} error={null} endedAt={null} latest />}
      </div>
    );
  }

  const resolved = status === "completed" && isLatest && !run.end?.answer?.trim() ? { ...view, ...resolveAnswer(view, latest.rowAnswer) } : view;
  const others = view.cards.filter(item => item.kind !== "attachments");
  const files = view.cards.filter(item => item.kind === "attachments");
  return (
    <div className="run-block" data-run={run.index}>
      {view.divider && <RunDivider divider={view.divider} />}
      {view.user && <UserBubble text={view.user.text} attachments={view.user.attachments} ts={view.user.ts} fresh={isFresh(view.user.seq, mark)} />}
      {view.entries.filter(item => item.kind === "user").map(item => <Card key={item.key} item={item} {...cardProps} />)}
      {status !== "cancelled" && <ProgressNotes notes={resolved.notes} />}
      {others.map(item => <Card key={item.key} item={item} {...cardProps} />)}
      <OutcomeCard
        view={resolved}
        status={status}
        reason={run.end && !run.end.synthetic ? run.end.reason ?? null : isLatest ? latest.reason : run.reason}
        error={runError(run) ?? (isLatest ? latest.error : null)}
        endedAt={run.end && !run.end.synthetic ? run.end.ts : isLatest ? latest.endedAt : null}
        outcome={run.end?.outcome ?? (isLatest ? latest.outcome : null)}
        latest={actionable}
        onRetry={props.onRetry}
        retrying={props.retrying}
        retryDisabled={props.retryDisabled}
        retryAs={props.retryAs}
        onViewLogs={props.onViewLogs}
        onCopied={props.onCopied}
        fresh={Boolean(run.end && isFresh(run.end.seq, mark))}
      />
      {files.map(item => <Card key={item.key} item={item} {...cardProps} />)}
    </div>
  );
});

function WorkingLine({ status, connected, phase }: { status: TaskStatus | null; connected: boolean; phase: string | null }) {
  if (status !== "queued" && status !== "running") return null;
  const text = !connected ? "Reconnecting to the live run…" : status === "queued" ? "Waiting to start…" : `Working${phase ? ` · ${phase}` : ""}`;
  return (
    <p className="working-line">
      <Spinner size={14} />
      <span>{text}</span>
    </p>
  );
}

export function Conversation(props: Props) {
  const { taskId, task, state, views, latest, active, streaming, pending, header, composer, scrollRef, stick } = props;
  const activePhase = PHASES.find(phase => state.phases[phase.id].state === "active");
  const loaded = isReplayed(state);
  const actions: Actions = { onRetry: props.onRetry, retrying: props.retrying, retryDisabled: props.retryDisabled, retryAs: props.retryAs, onViewLogs: props.onViewLogs, onCopied: props.onCopied };

  return (
    <section className="convo-pane" aria-label="Conversation">
      <div className="scroll-frame">
        <div className="convo-scroll" ref={scrollRef}>
          <div className="convo-content">
            {header}
            <div className="convo" role="log" aria-live="off" aria-busy={streaming || undefined} aria-label="Messages">
              {views.length === 0 && task && <UserBubble text={task.prompt} ts={task.createdAt} />}
              {views.length === 0 && !loaded && (task ? (
                <div className="convo-loading" aria-hidden="true"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>
              ) : (
                <StateNotice variant="loading" size="sm" title="Loading the conversation…" />
              ))}
              {views.length === 0 && loaded && !active && <StateNotice variant="empty" size="sm" title="No messages were recorded">This task's log is empty. Its stored status is shown above.</StateNotice>}
              {views.map((view, index) => (
                <RunBlock
                  key={view.run.seq}
                  view={view}
                  isLatest={index === views.length - 1}
                  latest={latest}
                  taskId={taskId}
                  browsers={state.browsers}
                  taskActive={active}
                  streamConnected={state.connected}
                  streaming={streaming}
                  mark={state.replayMark}
                  {...actions}
                />
              ))}
              {pending.map(message => <UserBubble key={message.clientMessageId} text={message.text} attachments={message.attachments} pending fresh />)}
              {pending.length === 0 && <WorkingLine status={latest.status} connected={state.connected} phase={activePhase ? PHASE_SHORT[activePhase.id] : null} />}
            </div>
          </div>
        </div>
        <JumpToLatest show={stick.showJump} unseen={stick.unseen} onJump={stick.jump} />
      </div>
      {composer}
    </section>
  );
}
