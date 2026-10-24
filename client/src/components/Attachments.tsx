import { useEffect, useState } from "react";
import { Archive, Code2, Database, Download, Eye, File, FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { agentApi, formatBytes } from "@/lib/api";
import { highlight, languageForPath } from "@/lib/highlight";
import type { Attachment } from "@/lib/taskStream";

// Files the agent produced, attached to the chat. Bytes live in Curialy Vault and are served
// through this app (/api/agent/media/:id), so links keep working after the workspace is archived.

const ICONS = { image: ImageIcon, pdf: FileText, archive: Archive, document: FileText, code: Code2, data: Database, other: File } as const;
const TEXT_PREVIEW = /\.(md|markdown|txt|csv|tsv|json|jsonl|ya?ml|xml|html?|sql|log|ini|toml|[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift|sh|css|scss|vue|svelte)$/i;

const canPreview = (file: Attachment) => file.kind === "image" || file.kind === "pdf" || (TEXT_PREVIEW.test(file.filename) && file.sizeBytes <= 5 * 1024 * 1024);

function Preview({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const [text, setText] = useState<{ content: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isText = file.kind !== "image" && file.kind !== "pdf";
  useEffect(() => {
    if (isText) agentApi.mediaText(file.mediaId).then(setText).catch(loadError => setError(loadError.message));
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [file.mediaId]);
  const language = languageForPath(file.filename);
  return (
    <div className="att-modal" role="dialog" aria-modal="true" aria-label={`Preview ${file.filename}`} onClick={onClose}>
      <div className="att-dialog" onClick={event => event.stopPropagation()}>
        <div className="att-dialog-head">
          <span className="mono truncate" title={file.path}>{file.path}</span>
          <span className="chip mono">{formatBytes(file.sizeBytes)}</span>
          <span className="spacer" />
          <a className="btn sm" href={agentApi.mediaDownloadUrl(file.mediaId)}><Download size={13} /> Download</a>
          <button className="icon-btn" onClick={onClose} aria-label="Close preview"><X size={16} /></button>
        </div>
        <div className="att-dialog-body">
          {file.kind === "image" && <div className="image-view"><img src={agentApi.mediaUrl(file.mediaId)} alt={file.filename} /></div>}
          {file.kind === "pdf" && <iframe className="att-pdf" src={agentApi.mediaUrl(file.mediaId)} title={file.filename} />}
          {isText && (error ? <div className="alert error" style={{ margin: 16 }}>{error}</div> : !text ? <div className="row faint" style={{ padding: 16 }}><Loader2 size={14} className="spin" /> Loading…</div> : (
            <>
              {text.truncated && <div className="alert warn" style={{ borderRadius: 0 }}>Showing the first 512 KB.</div>}
              {/\.(md|markdown)$/i.test(file.filename)
                ? <div className="att-markdown"><Markdown text={text.content} /></div>
                : <div className="code-view" style={{ maxHeight: "none" }}><table><tbody>{text.content.split("\n").map((line, index) => <tr key={index}><td className="ln">{index + 1}</td><td dangerouslySetInnerHTML={{ __html: line ? highlight(line, language) : " " }} /></tr>)}</tbody></table></div>}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Attachments({ files, auto, more, skipped }: { files: Attachment[]; auto: boolean; more: number; skipped: string[] }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  if (!files.length && !skipped.length) return null;
  return (
    <div className="attachments">
      <div className="att-label"><Paperclip size={12} /> {auto ? "Files from this run" : "Attached"} · {files.length}{more ? ` (+${more} more in Changes)` : ""}</div>
      <div className="att-grid">
        {files.map(file => {
          const Icon = ICONS[file.kind] ?? File;
          return (
            <div key={file.mediaId} className={`att-card${file.primary ? " primary" : ""}`}>
              {file.kind === "image" ? (
                <button className="att-thumb" onClick={() => setPreview(file)} title="Preview"><img src={agentApi.mediaUrl(file.mediaId)} alt={file.filename} loading="lazy" /></button>
              ) : (
                <div className={`att-icon ${file.kind}`}><Icon size={18} /></div>
              )}
              <div className="att-meta">
                <span className="att-name truncate" title={file.path}>{file.filename}</span>
                <span className="att-sub truncate">{file.path.includes("/") ? `${file.path.slice(0, file.path.lastIndexOf("/"))}/ · ` : ""}{formatBytes(file.sizeBytes)}</span>
              </div>
              <div className="att-actions">
                {canPreview(file) && <button className="icon-btn sm" onClick={() => setPreview(file)} title="Preview"><Eye size={14} /></button>}
                <a className="icon-btn sm" href={agentApi.mediaDownloadUrl(file.mediaId)} title={`Download ${file.filename}`}><Download size={14} /></a>
              </div>
            </div>
          );
        })}
      </div>
      {skipped.length > 0 && <div className="faint" style={{ fontSize: 11.5 }}>Not attached: {skipped.join("; ")}</div>}
      {preview && <Preview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
