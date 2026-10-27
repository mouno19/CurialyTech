import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import type { LucideIcon } from "lucide-react";
import { CloudOff, Download, File as FileIcon, FileArchive, FileAudio, FileCode2, FileSpreadsheet, FileText, FileVideo, ImageOff, Images, RotateCcw, Search, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, type TopbarAction } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { IconButton } from "@/components/common/IconButton";
import { StateNotice } from "@/components/common/StateNotice";
import { useCountdown } from "@/components/common/useCountdown";
import { useOverflowEdges } from "@/components/common/useOverflowEdges";
import { MediaImage, MediaLink } from "@/components/MediaImage";
import { agentApi, ApiError, errorMessage, formatBytes, relativeTime, type MediaFile, type MediaHealth, type MediaList } from "@/lib/api";
import { mediaHealth, useMediaHealth } from "@/lib/mediaHealth";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const LIST_LIMIT = 200;

type KindFilter = "all" | "upload" | "screenshot" | "artifact";
const KINDS: { id: KindFilter; label: string; empty: string }[] = [
  { id: "all", label: "All", empty: "No files" },
  { id: "upload", label: "Uploads", empty: "No uploads" },
  { id: "screenshot", label: "Screenshots", empty: "No screenshots" },
  { id: "artifact", label: "From tasks", empty: "No files from tasks" },
];
const KIND_LABEL: Record<string, string> = { upload: "Upload", screenshot: "Screenshot", artifact: "From a task" };

/** Setup problems need an operator; anything else is an outage that passes. */
const needsSetup = (health: MediaHealth | undefined) =>
  Boolean(health && !health.ok && (health.state === "not_configured" || ["not_configured", "unauthorized", "stage_missing"].includes(health.kind ?? "")));

function fileGlyph(file: MediaFile): LucideIcon {
  const { mimeType: mime, filename } = file;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (/zip|tar|gzip|compressed|7z|rar/.test(mime) || /\.(zip|tgz|gz|tar|7z|rar)$/i.test(filename)) return FileArchive;
  if (/csv|spreadsheet|excel/.test(mime) || /\.(csv|xlsx?|ods)$/i.test(filename)) return FileSpreadsheet;
  if (/json|javascript|typescript|x-python|x-sh|xml|html/.test(mime) || /\.(json|js|ts|tsx|py|sh|html?|css|sql|ya?ml)$/i.test(filename)) return FileCode2;
  if (mime.startsWith("text/") || mime === "application/pdf" || /\.(md|txt|pdf|docx?)$/i.test(filename)) return FileText;
  return FileIcon;
}
const extension = (filename: string) => (/\.([a-z0-9]{1,5})$/i.exec(filename)?.[1] ?? "").toUpperCase();
const fullDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function Media() {
  const [data, setData] = useState<MediaList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [target, setTarget] = useState<MediaFile | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const store = useMediaHealth();
  const input = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const refocusGrid = useRef(false);
  useOverflowEdges(filtersRef);

  const load = useCallback(async () => {
    try {
      const list = await agentApi.media();
      mediaHealth.observe(list.storage);
      setData(list);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Couldn't load your files."));
    }
  }, []);
  useEffect(() => void load(), [load]);
  // Storage came back: file states (and the setup notice) may have changed.
  const firstGeneration = useRef(store.generation);
  useEffect(() => {
    if (store.generation !== firstGeneration.current) void load();
  }, [store.generation, load]);

  const storageDown = store.status === "unavailable";
  const setup = needsSetup(data?.storage);
  const files = data?.files ?? [];
  const counts = useMemo(() => {
    const result: Record<KindFilter, number> = { all: files.length, upload: 0, screenshot: 0, artifact: 0 };
    for (const file of files) if (file.kind in result) result[file.kind as KindFilter] += 1;
    return result;
  }, [files]);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => files.filter(file => (kind === "all" || file.kind === kind) && (!needle || file.filename.toLowerCase().includes(needle))), [files, kind, needle]);

  const upload = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    if (mediaHealth.get().status === "unavailable") {
      toast.error("Uploads are paused", { description: "File storage isn't available right now." });
      return;
    }
    const tooBig = picked.filter(file => file.size > MAX_UPLOAD_BYTES);
    const queue = picked.filter(file => file.size <= MAX_UPLOAD_BYTES);
    tooBig.forEach(file => toast.error(`${file.name} is larger than 25 MB`, { description: "Files are limited to 25 MB each." }));
    if (!queue.length) return;
    setUploading({ done: 0, total: queue.length });
    const uploaded: string[] = [];
    for (const file of queue) {
      try {
        await agentApi.upload(file);
        uploaded.push(file.name);
        setUploading(progress => progress && { ...progress, done: progress.done + 1 });
      } catch (error) {
        if (error instanceof ApiError && error.code === "storage_unavailable") {
          toast.error("Uploads are paused", { description: `File storage isn't available right now${uploaded.length ? `, so ${queue.length - uploaded.length} of ${queue.length} files weren't uploaded` : ""}.` });
          break;
        }
        if (error instanceof ApiError && (error.status === 413 || error.code === "too_large")) toast.error(`${file.name} is larger than 25 MB`, { description: "Files are limited to 25 MB each." });
        else toast.error(`Couldn't upload ${file.name}`, { description: errorMessage(error) });
      }
    }
    setUploading(null);
    if (uploaded.length) {
      toast.success(uploaded.length === 1 ? `Uploaded ${uploaded[0]}` : `Uploaded ${uploaded.length} files`);
      await load();
    }
  };

  const askDelete = (file: MediaFile) => {
    // Stored files need storage to be removed; a missing file's record can always go.
    if (file.state !== "missing" && storageDown) {
      toast.error("Can't delete while storage is unavailable", { description: "Nothing was deleted. Try again once file storage is back." });
      return;
    }
    setTarget(file);
    setConfirmOpen(true);
  };

  const remove = async () => {
    const file = target;
    if (!file) return;
    const drop = () => setData(current => current && { ...current, files: current.files.filter(item => item.id !== file.id) });
    try {
      await agentApi.removeMedia(file.id);
      drop();
      refocusGrid.current = true;
      toast.success(file.state === "missing" ? `Removed ${file.filename}` : `Deleted ${file.filename}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        drop();
        refocusGrid.current = true;
        toast(`${file.filename} was already deleted`);
      } else if (error instanceof ApiError && error.status === 503) {
        toast.error("Can't delete while storage is unavailable", { description: "Nothing was deleted. Try again once file storage is back." });
      } else {
        toast.error(`Couldn't delete ${file.filename}`, { description: errorMessage(error) });
      }
    }
  };
  // The deleted tile (and its button) is gone: keep focus in the grid instead of losing it to the page.
  useEffect(() => {
    if (confirmOpen || !refocusGrid.current) return;
    refocusGrid.current = false;
    const timer = setTimeout(() => gridRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, [confirmOpen]);

  const actions: TopbarAction[] = [
    {
      id: "upload",
      label: uploading ? `Uploading ${Math.min(uploading.done + 1, uploading.total)} of ${uploading.total}…` : "Upload",
      icon: Upload,
      priority: "primary",
      tone: "accent",
      busy: Boolean(uploading),
      disabled: storageDown,
      title: storageDown ? "Uploads are paused while file storage is unavailable" : "Upload files, up to 25 MB each",
      onSelect: () => input.current?.click(),
    },
  ];

  return (
    <AppShell title="Media Vault" topbarActions={actions}>
      <input ref={input} type="file" multiple hidden onChange={event => { void upload(event.target.files); event.target.value = ""; }} />
      <div className="page">
        <div className="page-wide">
          <header className="page-head">
            <div>
              <span className="eyebrow">Files</span>
              <h2 className="page-title">Media Vault</h2>
              <p className="page-sub">Uploads, screenshots and files from your tasks, kept in Curialy Vault. Files open through short-lived links.</p>
            </div>
          </header>

          {storageDown && <StorageNotice setup={setup} />}

          {data === null ? (
            loadError ? (
              <div className="card">
                <StateNotice variant="error" title="Couldn't load your files" actions={<Button variant="primary" icon={RotateCcw} onClick={() => void load()}>Try again</Button>}>{loadError}</StateNotice>
              </div>
            ) : (
              <VaultSkeleton />
            )
          ) : files.length === 0 ? (
            <div className="card">
              <StateNotice
                variant="empty"
                icon={Images}
                size="lg"
                title="No files yet"
                actions={<Button variant="primary" icon={Upload} onClick={() => (storageDown ? toast.error("Uploads are paused", { description: "File storage isn't available right now." }) : input.current?.click())}>Upload files</Button>}
              >
                Attach files in the composer, or let the agent take screenshots with the Live Browser. Files that finished tasks produce show up here too.
              </StateNotice>
            </div>
          ) : (
            <>
              {loadError && (
                <div className="notice pg-notice" data-tone="danger" role="alert">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <div className="notice-body">{loadError} The list below may be out of date.</div>
                  <div className="notice-actions"><Button size="sm" icon={RotateCcw} onClick={() => void load()}>Try again</Button></div>
                </div>
              )}
              <div className="pg-toolbar">
                <div className="pg-filter-scroll" ref={filtersRef}>
                  <ToggleGroup.Root type="single" className="segmented pg-filters" aria-label="Show" value={kind} onValueChange={value => value && setKind(value as KindFilter)}>
                    {KINDS.map(item => (
                      <ToggleGroup.Item key={item.id} value={item.id} aria-label={`${item.label}, ${counts[item.id]}`}>
                        {item.label}
                        <span className="pg-count" aria-hidden="true">{counts[item.id]}</span>
                      </ToggleGroup.Item>
                    ))}
                  </ToggleGroup.Root>
                </div>
                <div className="input-wrap pg-search">
                  <Search size={15} aria-hidden="true" />
                  <label className="sr-only" htmlFor="media-search">Search files</label>
                  <input id="media-search" className="input" type="search" placeholder="Search by file name" value={query} onChange={event => setQuery(event.target.value)} />
                  {query && <IconButton className="input-end" size="sm" label="Clear search" icon={X} tooltip={false} onClick={() => setQuery("")} />}
                </div>
              </div>
              <div className="pg-statusline">
                <p role="status">
                  {visible.length === files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : `Showing ${visible.length} of ${files.length}`}
                  {files.length >= LIST_LIMIT ? ` · the latest ${LIST_LIMIT}` : ""}
                </p>
              </div>
              {visible.length === 0 ? (
                <div className="card">
                  <StateNotice variant="empty" title={needle ? `No files match “${query.trim()}”` : KINDS.find(item => item.id === kind)!.empty} actions={<Button onClick={() => { setQuery(""); setKind("all"); }}>Show all files</Button>}>
                    {needle ? "Try another name, or clear the search." : "Pick another kind to see the rest."}
                  </StateNotice>
                </div>
              ) : (
                <ul className="vault-grid" ref={gridRef} tabIndex={-1} aria-label="Files">
                  {visible.map(file => <VaultTile key={file.id} file={file} storageDown={storageDown} onDelete={askDelete} />)}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={target?.state === "missing" ? `Remove ${target.filename}?` : `Delete ${target?.filename ?? "this file"}?`}
        confirmLabel={target?.state === "missing" ? "Remove" : "Delete file"}
        busyLabel={target?.state === "missing" ? "Removing…" : "Deleting…"}
        tone="danger"
        onConfirm={remove}
      >
        {target?.state === "missing"
          ? "The file itself is already gone from storage; this removes it from the list."
          : "The file is removed from storage for good. Tasks that used it keep their history, but can no longer show or download it."}
      </ConfirmDialog>
    </AppShell>
  );
}

/** One explanation for the whole page while storage is down, with the shared retry countdown. */
function StorageNotice({ setup }: { setup: boolean }) {
  const store = useMediaHealth();
  const left = useCountdown(store.retryAt);
  return (
    <div className="notice vault-storage" data-tone={setup ? "warning" : "neutral"}>
      <CloudOff size={16} aria-hidden="true" />
      <div className="notice-body">
        <p className="notice-title" role="status">File storage isn't available right now</p>
        <p>Uploads are paused; existing files can't be shown until it's back.{setup && " An operator needs to finish the storage setup."}</p>
      </div>
      <div className="notice-actions">
        <Button size="sm" icon={RotateCcw} busy={store.probing} aria-disabled={left > 0 || undefined} onClick={() => void mediaHealth.retry()}>
          {store.probing ? "Checking…" : left > 0 ? `Check again in ${left} s` : "Check again"}
        </Button>
      </div>
    </div>
  );
}

function VaultTile({ file, storageDown, onDelete }: { file: MediaFile; storageDown: boolean; onDelete: (file: MediaFile) => void }) {
  const missing = file.state === "missing";
  const image = file.mimeType.startsWith("image/");
  const Glyph = fileGlyph(file);
  const ext = extension(file.filename);
  return (
    <li className="card vault-tile" data-state={file.state}>
      {missing ? (
        <span className="vault-thumb" data-empty="">
          <span className="vault-glyph">
            <ImageOff size={20} aria-hidden="true" />
            <span className="vault-glyph-label">No longer available</span>
          </span>
        </span>
      ) : (
        <MediaLink id={file.id} filename={file.filename} className="vault-thumb" aria-label={`Open ${file.filename}`}>
          {image ? (
            <MediaImage id={file.id} alt={file.filename} mime={file.mimeType} variant="thumb" />
          ) : (
            <span className="vault-glyph">
              <Glyph size={24} aria-hidden="true" />
              {ext && <span className="vault-ext">{ext}</span>}
            </span>
          )}
        </MediaLink>
      )}
      <div className="vault-info">
        <p className="vault-name truncate" title={file.filename}>{file.filename}</p>
        <p className="vault-meta">
          {KIND_LABEL[file.kind] ?? file.kind} · {formatBytes(file.sizeBytes)} · <time dateTime={file.createdAt} title={fullDate(file.createdAt)}>{relativeTime(file.createdAt)}</time>
        </p>
      </div>
      <div className="vault-actions">
        {missing ? (
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onDelete(file)}>Remove<span className="sr-only"> {file.filename}</span></Button>
        ) : (
          <>
            <MediaLink id={file.id} filename={file.filename} download className="btn ghost sm">
              <Download size={14} aria-hidden="true" /> Download<span className="sr-only"> {file.filename}</span>
            </MediaLink>
            <IconButton
              size="sm"
              tone="danger"
              label={`Delete ${file.filename}`}
              tooltip={storageDown ? "Can't delete while storage is unavailable" : "Delete"}
              icon={Trash2}
              data-blocked={storageDown || undefined}
              onClick={() => onDelete(file)}
            />
          </>
        )}
      </div>
    </li>
  );
}

function VaultSkeleton() {
  return (
    <div className="vault-grid">
      <p className="sr-only" role="status">Loading your files…</p>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="card vault-tile" aria-hidden="true">
          <span className="vault-thumb"><span className="skeleton vault-skeleton-thumb" /></span>
          <div className="vault-info">
            <span className="skeleton skeleton-text" />
            <span className="skeleton skeleton-text vault-skeleton-short" />
          </div>
        </div>
      ))}
    </div>
  );
}
