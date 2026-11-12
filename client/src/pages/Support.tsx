import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import { SUPPORT_LIMITS, type SupportThreadDetail, type SupportThreadSummary } from "@shared/support";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import { AppShell } from "@/components/shell/AppShell";
import { errorMessage, relativeTime } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { publishSupportUnread, supportApi } from "@/lib/support";
import "@/styles/support.css";

const WIDE = "(min-width: 900px)";

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return wide;
}

function when(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const onEnter = (event: KeyboardEvent<HTMLTextAreaElement>, send: () => void) => {
  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault();
    send();
  }
};

export default function Support() {
  const operator = useAccount().info?.user.role === "admin";
  const wide = useWide();
  const [threads, setThreads] = useState<SupportThreadSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [thread, setThread] = useState<SupportThreadDetail | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [pane, setPane] = useState<"list" | "thread">("list");
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seen = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const applyUnread = (next: number) => publishSupportUnread(next);

  const remember = (detail: SupportThreadDetail) => {
    setThread(detail);
    setThreads(current => (current ?? []).map(item => (item.id === detail.id
      ? { ...item, subject: detail.subject, status: detail.status, updatedAt: detail.updatedAt, preview: detail.messages.at(-1)?.body.slice(0, 160) ?? item.preview, unread: detail.unread, own: detail.own, account: detail.account }
      : item)));
  };

  useEffect(() => {
    let live = true;
    const load = () => {
      supportApi.threads().then(result => {
        if (!live) return;
        setThreads(result.threads);
        setLoadError(null);
        applyUnread(result.unread);
      }, failure => {
        if (live) setLoadError(errorMessage(failure, "Couldn't load your conversations."));
      });
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000);
    return () => { live = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!wide || selected || !threads?.length) return;
    setSelected(threads[0].id);
    setPane("thread");
  }, [wide, selected, threads]);

  useEffect(() => {
    if (!selected || selected === "new") {
      setThread(null);
      return;
    }
    const id = selected;
    let live = true;
    const load = () => {
      supportApi.thread(id).then(result => {
        if (!live || sendingRef.current || selectedRef.current !== id) return;
        remember(result.thread);
        setThreadError(null);
        applyUnread(result.unread);
      }, failure => {
        if (live && selectedRef.current === id) setThreadError(errorMessage(failure, "Couldn't open that conversation."));
      });
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, 8_000);
    return () => { live = false; clearInterval(timer); };
  }, [selected, reload]);

  useEffect(() => { seen.current = null; setNotice(""); }, [thread?.id]);

  useEffect(() => {
    const last = thread?.messages.at(-1);
    if (!last) return;
    if (seen.current && seen.current !== last.id && !last.mine) setNotice(`New reply: ${last.body.slice(0, 140)}`);
    seen.current = last.id;
  }, [thread]);

  useLayoutEffect(() => {
    if (stick.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [thread?.id, thread?.messages.length]);

  const open = (id: string) => {
    stick.current = true;
    setSelected(id);
    setPane("thread");
    setFormError(null);
    setClosing(false);
    setDraft("");
  };

  const startNew = () => {
    setSelected("new");
    setPane("thread");
    setThread(null);
    setFormError(null);
    setSubject("");
    setDraft("");
  };

  const sendExisting = async () => {
    if (!thread || sending || !draft.trim()) return;
    setSending(true);
    sendingRef.current = true;
    setFormError(null);
    try {
      const result = await supportApi.send(thread.id, draft);
      stick.current = true;
      setDraft("");
      remember(result.thread);
      applyUnread(result.unread);
    } catch (failure) {
      setFormError(errorMessage(failure, "Couldn't send that message."));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const start = async () => {
    if (sending || !subject.trim() || !draft.trim()) return;
    setSending(true);
    sendingRef.current = true;
    setFormError(null);
    try {
      const result = await supportApi.start({ subject, body: draft });
      stick.current = true;
      setSubject("");
      setDraft("");
      setThreads(current => [result.thread, ...(current ?? []).filter(item => item.id !== result.thread.id)]);
      setSelected(result.thread.id);
      setThread(result.thread);
      setPane("thread");
      applyUnread(result.unread);
    } catch (failure) {
      setFormError(errorMessage(failure, "Couldn't start that conversation."));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const close = async () => {
    if (!thread || sending) return;
    setSending(true);
    setFormError(null);
    try {
      const result = await supportApi.close(thread.id);
      remember(result.thread);
      setClosing(false);
      applyUnread(result.unread);
    } catch (failure) {
      setFormError(errorMessage(failure, "Couldn't close that conversation."));
    } finally {
      setSending(false);
    }
  };

  const who = (mine: boolean, fromStaff: boolean) => {
    if (mine) return "You";
    if (fromStaff) return "Curialy";
    return thread?.account?.name ?? "Account";
  };

  return (
    <AppShell title="Support">
      <div className="page">
        <header className="page-head">
          <div>
            <span className="eyebrow">Help</span>
            <h2 className="page-title">Support</h2>
            <p className="page-sub">{operator
              ? "Reply here when someone writes in. Each conversation is one issue, and it stays on this page."
              : "Write about something that isn't working. A reply shows up in the same conversation."}</p>
          </div>
        </header>

        {loadError && threads === null ? (
          <StateNotice variant="error" title="Couldn't load support" actions={<Button variant="primary" onClick={() => window.location.reload()}>Try again</Button>}>
            {loadError}
          </StateNotice>
        ) : (
          <div className="support-board" data-pane={pane}>
            <section className="card support-list" aria-labelledby="support-list-title">
              <div className="support-list-head">
                <h3 id="support-list-title">Conversations</h3>
                <Button size="sm" variant="primary" icon={LifeBuoy} onClick={startNew}>New issue</Button>
              </div>
              {threads === null ? (
                <StateNotice size="sm" variant="loading" title="Loading conversations…" />
              ) : threads.length === 0 ? (
                <StateNotice size="sm" variant="empty" title="No conversations yet" actions={<Button size="sm" variant="primary" onClick={startNew}>Start one</Button>}>
                  Describe what happened and a reply comes back here.
                </StateNotice>
              ) : (
                <ul className="support-items">
                  {threads.map(item => (
                    <li key={item.id}>
                      <button type="button" className="support-item" aria-current={selected === item.id ? "true" : undefined} data-unread={item.unread || undefined} onClick={() => open(item.id)}>
                        <span className="support-item-top">
                          <span className="support-item-subject">{item.subject}</span>
                          {item.status === "closed" && <span className="status-badge" data-tone="neutral" data-size="sm">Closed</span>}
                        </span>
                        <span className="support-item-preview">{item.preview}</span>
                        <span className="support-item-meta">
                          {!item.own && item.account && <span className="support-item-who">{item.account.name}</span>}
                          <span className="support-item-time">{relativeTime(item.updatedAt)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card support-thread" aria-labelledby="support-thread-title">
              {selected === "new" ? (
                <form className="support-new" onSubmit={event => { event.preventDefault(); void start(); }}>
                  <div className="support-thread-head">
                    <Button size="sm" variant="ghost" icon={ArrowLeft} className="support-back" onClick={() => setPane("list")}>Conversations</Button>
                    <h3 id="support-thread-title">New issue</h3>
                  </div>
                  <label className="field">
                    <span className="field-label" id="support-subject-label">Subject</span>
                    <input id="support-subject" className="input" aria-labelledby="support-subject-label" value={subject} maxLength={SUPPORT_LIMITS.subject} disabled={sending} placeholder="Preview stayed on building" onChange={event => setSubject(event.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field-label" id="support-body-label">What happened</span>
                    <textarea id="support-body" className="textarea" aria-labelledby="support-body-label" value={draft} maxLength={SUPPORT_LIMITS.body} disabled={sending} rows={6} placeholder="What you tried, and what you saw instead." onChange={event => setDraft(event.target.value)} onKeyDown={event => onEnter(event, () => void start())} />
                  </label>
                  {formError && <p className="field-error" role="alert">{formError}</p>}
                  <div>
                    <Button type="submit" variant="primary" busy={sending} aria-disabled={!subject.trim() || !draft.trim() || undefined}>Start conversation</Button>
                  </div>
                </form>
              ) : !selected ? (
                <>
                  <h3 id="support-thread-title" className="sr-only">Conversation</h3>
                  <StateNotice variant="empty" title="Choose a conversation" icon={LifeBuoy}>
                    Or start a new one from the list.
                  </StateNotice>
                </>
              ) : threadError && !thread ? (
                <>
                  <h3 id="support-thread-title" className="sr-only">Conversation</h3>
                  <StateNotice variant="error" title="Couldn't open it" actions={<Button size="sm" onClick={() => setReload(value => value + 1)}>Try again</Button>}>{threadError}</StateNotice>
                </>
              ) : !thread ? (
                <>
                  <h3 id="support-thread-title" className="sr-only">Conversation</h3>
                  <StateNotice variant="loading" title="Opening…" />
                </>
              ) : (
                <>
                  <div className="support-thread-head">
                    <Button size="sm" variant="ghost" icon={ArrowLeft} className="support-back" onClick={() => setPane("list")}>Conversations</Button>
                    <h3 id="support-thread-title">{thread.subject}</h3>
                    {thread.status === "open" && (closing ? (
                      <span className="row">
                        <Button size="sm" variant="danger" busy={sending} onClick={() => void close()}>Close</Button>
                        <Button size="sm" variant="ghost" onClick={() => setClosing(false)}>Keep</Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setClosing(true)}>Close</Button>
                    ))}
                  </div>
                  <div className="sr-only" aria-live="polite">{notice}</div>
                  <div className="support-messages" ref={scroller} role="log" aria-label={thread.subject} onScroll={event => {
                    const el = event.currentTarget;
                    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  }}>
                    {thread.messages.map(message => (
                      <article key={message.id} className="support-bubble" data-mine={message.mine ? "true" : "false"}>
                        <span className="support-bubble-who">{who(message.mine, message.fromStaff)} · {when(message.createdAt)}</span>
                        {message.body}
                      </article>
                    ))}
                  </div>
                  {thread.status === "closed" && <p className="support-closed">This conversation is closed. Send a message to open it again.</p>}
                  <form className="support-compose" onSubmit={event => { event.preventDefault(); void sendExisting(); }}>
                    <label className="sr-only" htmlFor="support-reply">Message</label>
                    <textarea id="support-reply" className="textarea" value={draft} maxLength={SUPPORT_LIMITS.body} disabled={sending} rows={2} placeholder={operator && !thread.own ? "Reply…" : "Write a message…"} onChange={event => setDraft(event.target.value)} onKeyDown={event => onEnter(event, () => void sendExisting())} />
                    <Button type="submit" variant="primary" busy={sending} aria-disabled={!draft.trim() || undefined}>Send</Button>
                    {formError && <p className="field-error support-form-error" role="alert">{formError}</p>}
                  </form>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
