import { useRef, useState } from "react";
import { ArrowUp, Paperclip, TriangleAlert } from "lucide-react";
import type { TaskStatus } from "@shared/agent";
import { isActiveStatus } from "@shared/taskStatus";
import { Button } from "@/components/common/Button";
import { cx } from "@/components/common/cx";
import { errorMessage } from "@/lib/api";
import { AttachmentTray, useAttachments, type PendingAttachment } from "@/lib/useAttachments";

const PLACEHOLDER: Record<TaskStatus, string> = {
  queued: "Waiting to start. You can send a follow-up when this run finishes.",
  running: "Working. You can draft a follow-up and send it when this run finishes.",
  cancelling: "Stopping… You can send a follow-up once the run has stopped.",
  completed: "Ask for changes, fixes or explanations (paste or drop screenshots)…",
  failed: "Describe what to change and send, or use Retry to run it again…",
  cancelled: "Send new instructions to continue, or use Retry…",
  interrupted: "Send a follow-up to continue from here, or use Retry…",
};

/** After a Deploy run the way to try again is a new deploy (a retry can't deploy). */
const REDEPLOY: Partial<Record<TaskStatus, string>> = {
  failed: "Describe what to change and send, or use Deploy again…",
  cancelled: "Send new instructions to continue, or use Deploy again…",
  interrupted: "Send a follow-up to continue from here, or use Deploy again…",
};

const BLOCKED: Record<"queued" | "running" | "cancelling", string> = {
  queued: "Available when this run finishes",
  running: "Available when this run finishes",
  cancelling: "Available once the run has stopped",
};

/**
 * The follow-up bar. Sending is possible whenever the task is not active (drafting always is);
 * the text clears at once and comes back if the send fails.
 */
export function FollowUpComposer({ status, onSend, redeploy = false }: { status: TaskStatus | null; onSend: (text: string, attachments: PendingAttachment[]) => Promise<void>; redeploy?: boolean }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachments = useAttachments();
  const input = useRef<HTMLTextAreaElement>(null);
  const active = isActiveStatus(status);
  const blocked = !status ? "Loading the task…" : active ? BLOCKED[status as keyof typeof BLOCKED] : null;
  const empty = !text.trim() && attachments.files.length === 0;
  const canSend = !blocked && !sending && attachments.uploading === 0 && !empty;

  const send = async () => {
    if (!canSend) return;
    const message = text.trim() || "See the attached file(s).";
    const files = attachments.files.slice();
    setSending(true);
    setError(null);
    setText("");
    try {
      await onSend(message, files);
      attachments.clear(files.map(file => file.id));
    } catch (failure) {
      setText(current => current || text);
      setError(errorMessage(failure, "Couldn't send the follow-up."));
      input.current?.focus();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="convo-foot">
      <div className="convo-foot-inner">
        <div className={cx("composer compact", attachments.dragging && "dragging")} {...attachments.dropProps}>
          <label className="sr-only" htmlFor="follow-up">Follow-up message</label>
          <textarea
            id="follow-up"
            ref={input}
            className="composer-input"
            value={text}
            rows={2}
            placeholder={status ? (redeploy && REDEPLOY[status]) || PLACEHOLDER[status] : "Loading…"}
            aria-describedby={error ? "follow-up-error" : blocked ? "follow-up-hint" : undefined}
            onChange={event => setText(event.target.value)}
            onPaste={attachments.onPaste}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <AttachmentTray files={attachments.files} uploading={attachments.uploading} onRemove={attachments.remove} />
          <div className="composer-bar">
            <div className="composer-tools">
              <button type="button" className="toggle" onClick={attachments.open} disabled={attachments.full} title="Attach files, or paste or drop screenshots into the box">
                <Paperclip size={14} aria-hidden="true" />
                <span className="toggle-label">Attach</span>
              </button>
              {attachments.picker}
            </div>
            <div className="composer-send">
              {blocked ? <span id="follow-up-hint" className="composer-hint" data-show="">{blocked}</span> : <span className="composer-hint"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>}
              <Button variant="accent" pill icon={ArrowUp} busy={sending} aria-disabled={!canSend || undefined} title={blocked ?? (empty ? "Write a message first" : undefined)} onClick={() => void send()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
        {(error || attachments.error) && (
          <p id="follow-up-error" className="field-error convo-error" role="alert">
            <TriangleAlert size={14} aria-hidden="true" />
            {error ?? attachments.error}
          </p>
        )}
      </div>
    </div>
  );
}
