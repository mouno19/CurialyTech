import { useEffect, useId, useState, type FormEvent } from "react";
import { Check, CheckCheck, Eye, EyeOff, KeyRound, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { agentApi, ApiError, errorMessage, type RequestAnswer } from "@/lib/api";
import type { OpenRequest } from "@/lib/taskStream";
import { Button } from "@/components/common/Button";
import { RoleBadge } from "@/components/deck/Team";

// What a live run waits for, above the composer: approving a change on GitHub (shown exactly), or
// a secret typed into a masked box. A secret goes straight to the server for this task: it never
// becomes a chat message, and the field is cleared as soon as it is sent.

function useMinutesLeft(expiresAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

function Expiry({ expiresAt }: { expiresAt: string }) {
  const left = useMinutesLeft(expiresAt);
  return <span className="request-expiry">{left > 0 ? `Waiting for you · ${left} min left` : "Expiring…"}</span>;
}

async function send(taskId: string, requestId: string, answer: RequestAnswer) {
  try {
    await agentApi.answerRequest(taskId, requestId, answer);
    return true;
  } catch (error) {
    toast.error(error instanceof ApiError && error.status === 410 ? "This request is no longer waiting: it expired or the run stopped." : errorMessage(error, "Couldn't send your answer. Try again."));
    return false;
  }
}

function ApprovalCard({ taskId, request }: { taskId: string; request: Extract<OpenRequest, { kind: "approval" }> }) {
  const [busy, setBusy] = useState<RequestAnswer | null>(null);
  const [sent, setSent] = useState(false);
  const titleId = useId();
  const answer = async (decision: "approved" | "approved_task" | "denied") => {
    const body = { decision } as const;
    setBusy(body);
    if (await send(taskId, request.requestId, body)) setSent(true);
    setBusy(null);
  };
  const isBusy = (decision: string) => Boolean(busy && "decision" in busy && busy.decision === decision);
  return (
    <section className="request-card" data-kind="approval" aria-labelledby={titleId}>
      <header className="request-head">
        <ShieldAlert size={16} aria-hidden="true" />
        <div className="request-head-text">
          <p className="request-eyebrow">Approve this change on {request.service}?{request.agent && <RoleBadge role={request.agent} />}</p>
          <h3 id={titleId} className="request-title">{request.title}</h3>
        </div>
        <Expiry expiresAt={request.expiresAt} />
      </header>
      <ul className="request-details">
        {request.details.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      <div className="request-actions">
        <Button variant="primary" size="sm" icon={Check} busy={isBusy("approved")} disabled={sent} onClick={() => void answer("approved")}>Approve</Button>
        {!request.once && <Button size="sm" icon={CheckCheck} busy={isBusy("approved_task")} disabled={sent} onClick={() => void answer("approved_task")}>Approve all in this task</Button>}
        <Button variant="danger" size="sm" icon={X} busy={isBusy("denied")} disabled={sent} onClick={() => void answer("denied")}>Deny</Button>
        {sent && <span className="request-sent" role="status">Sent</span>}
      </div>
    </section>
  );
}

function SecretCard({ taskId, request }: { taskId: string; request: Extract<OpenRequest, { kind: "secret" }> }) {
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState<"send" | "skip" | null>(null);
  const [sent, setSent] = useState(false);
  const titleId = useId();
  const fieldId = useId();
  const tooShort = value.length > 0 && value.length < 6;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value.length < 6 || busy) return;
    setBusy("send");
    const typed = value;
    // Out of the page's state at once: only the request carries it.
    setValue("");
    if (await send(taskId, request.requestId, { value: typed, save: request.canSave && save })) setSent(true);
    setBusy(null);
  };
  const skip = async () => {
    setBusy("skip");
    if (await send(taskId, request.requestId, { decline: true })) setSent(true);
    setBusy(null);
  };
  return (
    <section className="request-card" data-kind="secret" aria-labelledby={titleId}>
      <header className="request-head">
        <KeyRound size={16} aria-hidden="true" />
        <div className="request-head-text">
          <p className="request-eyebrow">The agent needs a secret{request.agent && <RoleBadge role={request.agent} />}</p>
          <h3 id={titleId} className="request-title mono">{request.name}</h3>
          {request.reason && <p className="request-reason">{request.reason}</p>}
        </div>
        <Expiry expiresAt={request.expiresAt} />
      </header>
      <form className="request-secret" onSubmit={event => void submit(event)} autoComplete="off">
        <label className="sr-only" htmlFor={fieldId}>{request.name}</label>
        <div className="request-secret-field">
          <input
            id={fieldId}
            className="input mono"
            type={shown ? "text" : "password"}
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder="Paste or type the secret"
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore=""
            data-lpignore="true"
            disabled={sent}
            aria-invalid={tooShort || undefined}
            aria-describedby={`${fieldId}-hint`}
          />
          <button type="button" className="icon-btn sm" onClick={() => setShown(current => !current)} aria-label={shown ? "Hide the secret" : "Show the secret"} aria-pressed={shown} disabled={sent}>
            {shown ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          </button>
        </div>
        <p id={`${fieldId}-hint`} className="request-hint">{tooShort ? "A secret has at least 6 characters." : "Hidden from the agent and never saved in this chat. Its commands get it as an environment variable."}</p>
        {request.canSave && (
          <label className="request-save">
            <input type="checkbox" checked={save} onChange={event => setSave(event.target.checked)} disabled={sent} />
            <span>Also save it to my secrets (encrypted), for later tasks</span>
          </label>
        )}
        <div className="request-actions">
          <Button type="submit" variant="primary" size="sm" icon={Check} busy={busy === "send"} disabled={sent || value.length < 6}>Use this secret</Button>
          <Button size="sm" icon={X} busy={busy === "skip"} disabled={sent} onClick={() => void skip()}>Don't provide</Button>
          {sent && <span className="request-sent" role="status">Sent</span>}
        </div>
      </form>
    </section>
  );
}

export function RequestPanel({ taskId, requests }: { taskId: string; requests: OpenRequest[] }) {
  if (!requests.length) return null;
  return (
    <div className="request-stack" role="region" aria-label="Waiting for your answer">
      {requests.map(request => (request.kind === "approval"
        ? <ApprovalCard key={request.requestId} taskId={taskId} request={request} />
        : <SecretCard key={request.requestId} taskId={taskId} request={request} />))}
    </div>
  );
}
