import { memo } from "react";
import { FileText, Paperclip, RotateCcw, Rocket } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { MediaImage, MediaLink } from "@/components/MediaImage";
import { RoleBadge } from "@/components/deck/Team";
import type { ItemOf, RunView, UserAttachment } from "@/lib/taskStream";
import { formatClock, fullDate, plural } from "./format";

const IMAGE = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/;

/** A message the user sent; `pending` while the server has not echoed it yet. */
export function UserBubble({ text, attachments, ts, pending, fresh }: { text: string; attachments?: UserAttachment[]; ts?: string; pending?: boolean; fresh?: boolean }) {
  const clock = ts ? formatClock(ts) : null;
  return (
    <div className="msg-user-wrap" data-fresh={fresh || undefined} data-pending={pending || undefined}>
      {attachments && attachments.length > 0 && (
        <ul className="msg-user-files" aria-label={plural(attachments.length, "attachment")}>
          {attachments.map(file => (
            <li key={file.mediaId}>
              {IMAGE.test(file.mimeType) ? (
                <MediaLink id={file.mediaId} filename={file.filename} className="msg-user-thumb" aria-label={`Open ${file.filename}`}>
                  <MediaImage id={file.mediaId} alt={file.filename} variant="thumb" />
                </MediaLink>
              ) : (
                <MediaLink id={file.mediaId} filename={file.filename} download className="chip" title={file.path}>
                  <Paperclip size={12} aria-hidden="true" />
                  <span className="truncate">{file.filename}</span>
                </MediaLink>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="msg-user">
        <span className="sr-only">You said: </span>
        {text}
      </div>
      {(pending || clock) && (
        <span className="msg-meta">
          {pending ? "Sending…" : <time dateTime={ts} title={ts ? fullDate(ts) : undefined}>{clock}</time>}
        </span>
      )}
    </div>
  );
}

/** Retry and deploy runs start with a chip, not with a message the user never wrote. */
export function RunDivider({ divider }: { divider: NonNullable<RunView["divider"]> }) {
  const Icon = divider.trigger === "retry" ? RotateCcw : Rocket;
  const label = divider.trigger === "retry" ? `Retry · attempt ${divider.attempt}` : "Deploy requested";
  const clock = formatClock(divider.ts);
  return (
    <div className="run-divider" role="separator" aria-label={label}>
      <span className="run-chip">
        <Icon size={12} aria-hidden="true" />
        {label}
        {clock && <time dateTime={divider.ts}> · {clock}</time>}
      </span>
    </div>
  );
}

/** An interim message (progress), visually distinct from the answer. */
export const ProgressNote = memo(function ProgressNote({ item, streaming, fresh }: { item: ItemOf<"text">; streaming: boolean; fresh?: boolean }) {
  const live = !item.done && streaming;
  return (
    <div className="msg-note" data-role={item.agent} data-fresh={fresh || undefined}>
      {item.agent && <RoleBadge role={item.agent} />}
      <Markdown text={item.text || " "} />
      {live && <span className="caret" aria-hidden="true" />}
    </div>
  );
});

/** After a run ends, its interim messages fold into one disclosure. */
export function ProgressNotes({ notes, label }: { notes: ItemOf<"text">[]; label?: string }) {
  if (!notes.length) return null;
  return (
    <details className="progress-notes">
      <summary>
        <FileText size={13} aria-hidden="true" />
        {label ?? plural(notes.length, "progress note")}
      </summary>
      <div className="progress-notes-body">
        {notes.map(note => <ProgressNote key={note.key} item={note} streaming={false} />)}
      </div>
    </details>
  );
}
