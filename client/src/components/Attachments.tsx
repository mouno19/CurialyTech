import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import { Archive, AudioLines, Clapperboard, CodeXml, Database, Download, Eye, File, FileText, Image as ImageIcon, Paperclip, TriangleAlert } from "lucide-react";
import type { GeneratedSummary } from "@shared/agent";
import { isGeneratedPath } from "@shared/generated";
import { Markdown } from "@/components/Markdown";
import { MediaImage, MediaLink } from "@/components/MediaImage";
import { useMediaHealth } from "@/lib/mediaHealth";
import { Button } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { IconButton } from "@/components/common/IconButton";
import { PathLabel } from "@/components/common/PathLabel";
import { StateNotice } from "@/components/common/StateNotice";
import { Tip } from "@/components/common/Tooltip";
import { agentApi, errorMessage, formatBytes } from "@/lib/api";
import { highlight, languageForPath } from "@/lib/highlight";
import type { Attachment } from "@/lib/taskStream";

// Files a run produced, attached to the chat. Deliverables first; build output (bundles, hashed
// assets) is grouped and collapsed. Stored files are served from Curialy Vault; when storage was
// unavailable they were kept in the workspace instead (source "workspace", no media id).

const ICONS: Record<Attachment["kind"], LucideIcon> = { image: ImageIcon, audio: AudioLines, video: Clapperboard, pdf: FileText, archive: Archive, document: FileText, code: CodeXml, data: Database, other: File };
const TEXT_PREVIEW = /\.(md|markdown|txt|csv|tsv|json|jsonl|ya?ml|xml|html?|sql|log|ini|toml|[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift|sh|css|scss|vue|svelte)$/i;
const VISIBLE = 6;
const RANK: Record<Attachment["kind"], number> = { image: 1, audio: 1, video: 1, pdf: 1, document: 1, archive: 2, data: 2, code: 3, other: 4 };

const isStored = (file: Attachment) => Boolean(file.mediaId);
const isText = (file: Attachment) => file.kind !== "image" && file.kind !== "pdf" && file.kind !== "audio" && file.kind !== "video" && TEXT_PREVIEW.test(file.filename) && file.sizeBytes <= 5 * 1024 * 1024;
/** Played inline (the same types the server serves inline); others download. */
const PLAYABLE = /^(audio\/(mpeg|mp4|aac|ogg|wav|webm|flac)|video\/(mp4|webm))$/;
const isPlayable = (file: Attachment) => (file.kind === "audio" || file.kind === "video") && PLAYABLE.test(file.mimeType);
const canPreview = (file: Attachment) => file.kind === "image" || isPlayable(file) || (file.kind === "pdf" && isStored(file)) || isText(file);
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

/** Deliverables (primary first, then documents and images) and build output (older logs listed it). */
export function groupAttachments(files: Attachment[]) {
  const deliverables: Attachment[] = [];
  const build: Attachment[] = [];
  // A file the agent attached on purpose is a deliverable even if it sits in a build folder.
  for (const file of files) (!file.primary && isGeneratedPath(file.path) ? build : deliverables).push(file);
  deliverables.sort((a, b) => Number(b.primary) - Number(a.primary) || RANK[a.kind] - RANK[b.kind]);
  return { deliverables, build };
}

function generatedWhere(generated: GeneratedSummary) {
  const [first, ...rest] = generated.dirs;
  if (!first) return "the workspace";
  return rest.length ? `${first.dir} and ${rest.length} more folder${rest.length === 1 ? "" : "s"}` : first.dir;
}

type Props = {
  taskId: string;
  files: Attachment[];
  auto: boolean;
  more: number;
  skipped: string[];
  generated?: GeneratedSummary;
  partial?: boolean;
};

export function Attachments({ taskId, files, auto, more, skipped, generated, partial }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const { deliverables, build } = useMemo(() => groupAttachments(files), [files]);
  if (!files.length && !skipped.length && !generated?.count) return null;
  const shown = showAll ? deliverables : deliverables.slice(0, VISIBLE);
  const buildBytes = build.reduce((sum, file) => sum + file.sizeBytes, 0);
  const label = partial ? "Files from the failed run" : auto ? "Files from this run" : "Attached";
  const extra = [build.length ? `+${build.length} build files` : "", more ? `+${more} more in Changes` : ""].filter(Boolean).join(", ");
  return (
    <section className="attachments" aria-label={label}>
      <h3 className="att-label">
        <Paperclip size={12} aria-hidden="true" />
        {label} · {deliverables.length}
        {extra && <span className="att-extra"> ({extra})</span>}
      </h3>
      {shown.length > 0 && (
        <ul className="att-grid">
          {shown.map(file => (
            <li key={`${file.mediaId ?? "ws"}:${file.path}`}>
              <AttachmentCard taskId={taskId} file={file} onPreview={() => setPreview(file)} />
            </li>
          ))}
        </ul>
      )}
      {deliverables.length > VISIBLE && (
        <Button variant="link" size="sm" className="att-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
          {showAll ? "Show fewer" : `Show all ${deliverables.length}`}
        </Button>
      )}
      {build.length > 0 && (
        <details className="att-group" onToggle={event => setBuildOpen(event.currentTarget.open)}>
          <summary>Build output · {build.length} files · {formatBytes(buildBytes)}</summary>
          {/* Rendered only while open: a closed group loads no thumbnails and runs no skeletons. */}
          {buildOpen && (
            <ul className="att-grid">
              {build.map(file => (
                <li key={`${file.mediaId ?? "ws"}:${file.path}`}>
                  <AttachmentCard taskId={taskId} file={file} onPreview={() => setPreview(file)} />
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      {generated && generated.count > 0 && (
        <p className="att-note">
          +{generated.count} build file{generated.count === 1 ? "" : "s"} in {generatedWhere(generated)}{generated.bytes ? ` (${formatBytes(generated.bytes)})` : ""} (not attached, available in the{" "}
          <Link href={`/sandbox?task=${encodeURIComponent(taskId)}`} className="link">Code Sandbox</Link>)
        </p>
      )}
      {skipped.length > 0 && (
        <div className="att-skipped">
          <span className="micro">Not attached</span>
          <ul>{skipped.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        </div>
      )}
      {preview && <AttachmentPreview taskId={taskId} file={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function DownloadLink({ taskId, file, className, children, label }: { taskId: string; file: Attachment; className: string; children: ReactNode; label?: string }) {
  if (file.mediaId) {
    return (
      <MediaLink id={file.mediaId} filename={file.filename} download className={className} aria-label={label}>
        {children}
      </MediaLink>
    );
  }
  return (
    <a href={agentApi.downloadUrl(taskId, file.path)} download={file.filename} className={className} aria-label={label}>
      {children}
    </a>
  );
}

/** While file storage is down a task's images still show from its workspace (or archived) copy. */
function useWorkspaceCopy(file: Attachment) {
  const store = useMediaHealth();
  return !file.mediaId || store.status === "unavailable";
}

function AttachmentCard({ taskId, file, onPreview }: { taskId: string; file: Attachment; onPreview: () => void }) {
  const Icon = ICONS[file.kind] ?? File;
  const dir = dirOf(file.path);
  const fromWorkspace = useWorkspaceCopy(file);
  const thumb = file.kind === "image"
    ? fromWorkspace
      ? <MediaImage src={agentApi.rawFileUrl(taskId, file.path)} alt={file.filename} variant="thumb" />
      : <MediaImage id={file.mediaId} alt={file.filename} variant="thumb" />
    : null;
  return (
    <div className="att-card" data-primary={file.primary || undefined}>
      {thumb ? (
        <button type="button" className="att-thumb" onClick={onPreview} aria-label={`Preview ${file.filename}`}>{thumb}</button>
      ) : (
        <span className="att-icon" data-kind={file.kind} aria-hidden="true"><Icon size={18} /></span>
      )}
      <div className="att-meta">
        <span className="att-name" title={file.path}>{file.filename}</span>
        <span className="att-sub">
          {dir && <PathLabel path={dir} className="att-dir" />}
          <span>{formatBytes(file.sizeBytes)}</span>
        </span>
        {!file.mediaId && <span className="att-source">Kept in the workspace (file storage unavailable)</span>}
      </div>
      <div className="att-actions">
        {canPreview(file) && <IconButton size="sm" label={`Preview ${file.filename}`} icon={Eye} onClick={onPreview} />}
        <Tip content={`Download ${file.filename}`}>
          <DownloadLink taskId={taskId} file={file} className="icon-btn sm" label={`Download ${file.filename}`}>
            <Download size={14} aria-hidden="true" />
          </DownloadLink>
        </Tip>
      </div>
    </div>
  );
}

type TextState = { phase: "loading" } | { phase: "ready"; content: string; truncated: boolean } | { phase: "error"; message: string };

function AttachmentPreview({ taskId, file, onClose }: { taskId: string; file: Attachment; onClose: () => void }) {
  const fromWorkspace = useWorkspaceCopy(file);
  const text = isText(file);
  const [content, setContent] = useState<TextState>({ phase: "loading" });
  const [pdf, setPdf] = useState<"checking" | "ok" | number>("checking");
  const [playError, setPlayError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    setContent({ phase: "loading" });
    const load = file.mediaId && !fromWorkspace
      ? agentApi.mediaText(file.mediaId).then(result => ({ content: result.content, truncated: result.truncated }))
      : agentApi.file(taskId, file.path).then(result => ({ content: result.binary ? "" : result.content, truncated: Boolean(result.truncated) }));
    load.then(
      result => !cancelled && setContent({ phase: "ready", ...result }),
      failure => !cancelled && setContent({ phase: "error", message: errorMessage(failure, "Couldn't load this file.") }),
    );
    return () => {
      cancelled = true;
    };
  }, [text, file.mediaId, file.path, taskId, attempt, fromWorkspace]);

  // A stored PDF is shown in a frame: check it first so a missing file never renders an error page.
  useEffect(() => {
    if (file.kind !== "pdf" || !file.mediaId) return;
    let cancelled = false;
    setPdf("checking");
    agentApi.mediaHead(file.mediaId).then(status => !cancelled && setPdf(status === 200 ? "ok" : status));
    return () => {
      cancelled = true;
    };
  }, [file.kind, file.mediaId, attempt]);

  const language = languageForPath(file.filename);
  const markdown = /\.(md|markdown)$/i.test(file.filename);

  return (
    <Dialog
      open
      onOpenChange={next => !next && onClose()}
      size="xl"
      title={file.filename}
      description={<PathLabel path={file.path} title={false} />}
      className="att-dialog"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <DownloadLink taskId={taskId} file={file} className="btn primary">
            <Download size={15} aria-hidden="true" /> Download · {formatBytes(file.sizeBytes)}
          </DownloadLink>
        </>
      }
    >
      <div className="att-preview">
        {file.kind === "image" && (
          <div className="image-view">
            {!fromWorkspace && file.mediaId ? <MediaImage id={file.mediaId} alt={file.filename} /> : <MediaImage src={agentApi.rawFileUrl(taskId, file.path)} alt={file.filename} />}
          </div>
        )}
        {isPlayable(file) && (playError
          ? <StateNotice variant="error" size="sm" title={`Couldn't play this ${file.kind}`}>It may have been removed, or this browser can't play the format. Download it instead.</StateNotice>
          : (() => {
            const src = !fromWorkspace && file.mediaId ? agentApi.mediaUrl(file.mediaId) : agentApi.rawFileUrl(taskId, file.path);
            return file.kind === "audio"
              ? <audio className="att-audio" controls preload="metadata" src={src} onError={() => setPlayError(true)}>Your browser can't play this audio; download it instead.</audio>
              : <video className="att-video" controls preload="metadata" src={src} onError={() => setPlayError(true)}>Your browser can't play this video; download it instead.</video>;
          })())}
        {file.kind === "pdf" && file.mediaId && (
          pdf === "ok" ? <iframe className="att-pdf" src={agentApi.mediaUrl(file.mediaId)} title={file.filename} />
            : pdf === "checking" ? <StateNotice variant="loading" size="sm" title="Opening the PDF…" />
              : <StateNotice variant={pdf === 404 || pdf === 410 ? "unavailable" : "error"} size="sm" title={pdf === 404 || pdf === 410 ? "No longer available here" : "Couldn't open the PDF"} actions={pdf === 404 || pdf === 410 ? undefined : <Button size="sm" onClick={() => setAttempt(value => value + 1)}>Try again</Button>}>
                  {pdf === 503 ? "File storage isn't responding right now." : pdf === 404 || pdf === 410 ? "It was removed, or it is in a storage location this server no longer reads." : "Check your connection and try again."}
                </StateNotice>
        )}
        {text && (
          content.phase === "loading" ? <StateNotice variant="loading" size="sm" title="Loading the file…" />
            : content.phase === "error" ? <StateNotice variant="error" size="sm" title="Couldn't load this file" actions={<Button size="sm" onClick={() => setAttempt(value => value + 1)}>Try again</Button>}>{content.message}</StateNotice>
              : (
                <>
                  {content.truncated && <p className="notice" data-tone="warning"><TriangleAlert size={14} aria-hidden="true" /><span className="notice-body">Showing the beginning of the file only.</span></p>}
                  {markdown
                    ? <div className="att-markdown"><Markdown text={content.content} /></div>
                    : (
                      <div className="code-view" tabIndex={0} aria-label={`Contents of ${file.filename}`}>
                        <table><tbody>{content.content.split("\n").map((line, index) => <tr key={index}><td className="ln" aria-hidden="true">{index + 1}</td><td dangerouslySetInnerHTML={{ __html: line ? highlight(line, language) : " " }} /></tr>)}</tbody></table>
                      </div>
                    )}
                </>
              )
        )}
        {!canPreview(file) && (
          <StateNotice variant="info" size="sm" title="No preview for this file type">
            {file.kind === "pdf" ? "This PDF was kept in the workspace; download it to read it." : "Download the file to open it."}
          </StateNotice>
        )}
      </div>
    </Dialog>
  );
}
