import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { Link, useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import { CheckCheck, CloudOff, Download, File as FileIcon, FileArchive, FileAudio, FileCode2, FileSpreadsheet, FileText, FileVideo, ImageOff, Images, ListChecks, RotateCcw, Search, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { FREE_VAULT_BYTES, FREE_VAULT_FILES, MAX_UPLOAD_BYTES, vaultFull, type MediaKind, type VaultQuota, type VaultSummary } from "@shared/media";
import { AppShell, type TopbarAction } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { IconButton } from "@/components/common/IconButton";
import { StateNotice } from "@/components/common/StateNotice";
import { useCountdown } from "@/components/common/useCountdown";
import { useOverflowEdges } from "@/components/common/useOverflowEdges";
import { MediaImage, MediaLink } from "@/components/MediaImage";
import { agentApi, ApiError, busyWait, errorMessage, formatBytes, relativeTime, type MediaFile, type MediaHealth, type MediaQuery } from "@/lib/api";
import { mediaHealth, useMediaHealth } from "@/lib/mediaHealth";
import { whileBusy } from "@/lib/uploads";
import { deleteInTurns, goneCount, toggleSelection, type DeleteOutcome } from "@/lib/vaultSelection";

type KindFilter = "all" | MediaKind;
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
const count = (value: number) => value.toLocaleString("en-US");
const filesText = (value: number) => `${count(value)} ${value === 1 ? "file" : "files"}`;

type View = { kind: KindFilter; q: string };
const queryOf = (view: View): MediaQuery => ({ kind: view.kind === "all" ? undefined : view.kind, q: view.q || undefined });
type Listing = { files: MediaFile[]; nextCursor: string | null; matching: number };
type Vault = { summary: VaultSummary; quota: VaultQuota; storage: MediaHealth };

/** The vault without one file the page knows (its kind, size and state). */
function withoutFile(summary: VaultSummary, file: MediaFile): VaultSummary {
  const counted = file.state !== "missing";
  const kind = file.kind as MediaKind;
  return {
    total: Math.max(0, summary.total - 1),
    byKind: kind in summary.byKind ? { ...summary.byKind, [kind]: Math.max(0, summary.byKind[kind] - 1) } : summary.byKind,
    usedFiles: Math.max(0, summary.usedFiles - (counted ? 1 : 0)),
    usedBytes: Math.max(0, summary.usedBytes - (counted ? file.sizeBytes : 0)),
  };
}

/** What the confirm dialog deletes: one file, the chosen ones, or the whole vault. */
type Pending = { mode: "one"; file: MediaFile } | { mode: "selected"; ids: string[] } | { mode: "all"; count: number; bytes: number };

type UploadState = "waiting" | "uploading" | "saving" | "done" | "failed" | "cancelled";
type UploadItem = { key: number; file: File; state: UploadState; sent: number; waitingOnOthers?: boolean; error?: string; retryable?: boolean };
const isActive = (item: UploadItem) => item.state === "waiting" || item.state === "uploading" || item.state === "saving";

function uploadError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "quota") return "Your Media Vault is full";
    if (error.code === "too_large" || (error.status === 413 && !error.code)) return "Larger than 25 MB";
    if (error.code === "storage_unavailable") return "File storage isn't available right now";
    if (error.code === "busy") return "Your other uploads took too long. Try again.";
  }
  return errorMessage(error, "Upload failed");
}

const fullDescription = (quota: VaultQuota | undefined) =>
  `A free account keeps up to ${formatBytes(quota?.maxBytes ?? FREE_VAULT_BYTES)} or ${count(quota?.maxFiles ?? FREE_VAULT_FILES)} files. Delete files you no longer need, or get a plan for unlimited storage.`;

export default function Media() {
  const [view, setView] = useState<View>({ kind: "all", q: "" });
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const store = useMediaHealth();
  const [, navigate] = useLocation();
  const input = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const refocusGrid = useRef(false);
  const anchor = useRef<string | null>(null);
  const request = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const uploadAbort = useRef<AbortController | null>(null);
  const uploadKey = useRef(0);
  useOverflowEdges(filtersRef);

  /** The first page of what the page shows; a newer load wins over an older one. */
  const load = useCallback(async (target?: View) => {
    const ticket = ++request.current;
    try {
      const page = await agentApi.media(queryOf(target ?? viewRef.current));
      if (ticket !== request.current) return;
      mediaHealth.observe(page.storage);
      setListing({ files: page.files, nextCursor: page.nextCursor, matching: page.matching });
      setVault({ summary: page.summary, quota: page.quota, storage: page.storage });
      setLoadError(null);
    } catch (error) {
      if (ticket === request.current) setLoadError(errorMessage(error, "Couldn't load your files."));
    }
  }, []);

  // Another kind or search: its first page, with nothing chosen from the last one.
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
    void load(view);
  }, [view, load]);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const q = query.trim();
    if (q === viewRef.current.q) return;
    const timer = setTimeout(() => setView(current => ({ ...current, q })), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Storage came back: file states (and the setup notice) may have changed.
  const firstGeneration = useRef(store.generation);
  useEffect(() => {
    if (store.generation !== firstGeneration.current) void load();
  }, [store.generation, load]);

  const loadMore = async () => {
    const cursor = listing?.nextCursor;
    if (!cursor || loadingMore) return;
    const ticket = request.current;
    setLoadingMore(true);
    try {
      const page = await agentApi.media({ ...queryOf(viewRef.current), cursor });
      if (ticket !== request.current) return;
      setListing(current => {
        if (!current) return current;
        const seen = new Set(current.files.map(file => file.id));
        return { files: [...current.files, ...page.files.filter(file => !seen.has(file.id))], nextCursor: page.nextCursor, matching: page.matching };
      });
      setVault({ summary: page.summary, quota: page.quota, storage: page.storage });
    } catch (error) {
      if (ticket === request.current) toast.error("Couldn't show more files", { description: errorMessage(error) });
    } finally {
      setLoadingMore(false);
    }
  };

  const storageDown = store.status === "unavailable";
  const setup = needsSetup(vault?.storage);
  const files = useMemo(() => listing?.files ?? [], [listing]);
  const order = useMemo(() => files.map(file => file.id), [files]);
  const summary = vault?.summary;
  const total = summary?.total ?? 0;
  const counts: Record<KindFilter, number> = { all: total, upload: summary?.byKind.upload ?? 0, screenshot: summary?.byKind.screenshot ?? 0, artifact: summary?.byKind.artifact ?? 0 };
  const filtered = view.kind !== "all" || view.q !== "";
  const selectionMode = selecting || selected.size > 0;
  const matching = listing?.matching ?? 0;

  // ---- Uploads: many at once, a couple at a time, each with its own progress ----

  const patch = (key: number, change: Partial<UploadItem>) => setUploads(items => items.map(item => (item.key === key ? { ...item, ...change } : item)));
  const showFull = () => toast.error("Your Media Vault is full", { description: fullDescription(vault?.quota), action: { label: "See plans", onClick: () => navigate("/billing") } });

  const startUploads = async (picked: File[]) => {
    if (!picked.length) return;
    if (mediaHealth.get().status === "unavailable") {
      toast.error("Uploads are paused", { description: "File storage isn't available right now." });
      return;
    }
    if (vault && vaultFull(vault.summary, vault.quota)) {
      showFull();
      return;
    }
    if (!uploadAbort.current || uploadAbort.current.signal.aborted) uploadAbort.current = new AbortController();
    const signal = uploadAbort.current.signal;
    const items: UploadItem[] = picked.map(file => (file.size > MAX_UPLOAD_BYTES
      ? { key: ++uploadKey.current, file, state: "failed", sent: 0, error: "Larger than 25 MB" }
      : { key: ++uploadKey.current, file, state: "waiting", sent: 0 }));
    // A new batch replaces a finished one; while one runs, it joins it.
    setUploads(current => (current.some(isActive) ? [...current, ...items] : items));
    const stored: string[] = [];
    let stopped: string | null = null;
    await Promise.all(items.filter(item => item.state === "waiting").map(async item => {
      try {
        await agentApi.upload(item.file, {
          signal,
          onStart: () => patch(item.key, { state: "uploading", waitingOnOthers: false }),
          onWait: () => patch(item.key, { state: "waiting", waitingOnOthers: true, sent: 0 }),
          onProgress: (sent, size) => patch(item.key, sent >= size ? { state: "saving", sent } : { state: "uploading", sent }),
        });
        stored.push(item.file.name);
        patch(item.key, { state: "done", sent: item.file.size });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          patch(item.key, stopped ? { state: "failed", error: stopped, retryable: true } : { state: "cancelled" });
          return;
        }
        const message = uploadError(error);
        // A full vault or storage going down stops the rest at once instead of failing them one by one.
        if (error instanceof ApiError && (error.code === "quota" || error.code === "storage_unavailable") && !stopped) {
          stopped = message;
          if (error.code === "quota") showFull();
          uploadAbort.current?.abort();
        }
        patch(item.key, { state: "failed", error: message, retryable: !(error instanceof ApiError && error.code === "too_large") });
      }
    }));
    if (stored.length) {
      toast.success(stored.length === 1 ? `Uploaded ${stored[0]}` : `Uploaded ${filesText(stored.length)}`);
      await load();
    }
  };
  const uploadsRunning = uploads.some(isActive);
  const retryFailed = () => {
    const again = uploads.filter(item => item.state === "failed" && item.retryable).map(item => item.file);
    setUploads(items => items.filter(item => !(item.state === "failed" && item.retryable)));
    void startUploads(again);
  };

  // Files dropped anywhere on the page upload; a drop that misses it must not open the file in the tab.
  useEffect(() => {
    const stray = (event: Event) => { if ((event as globalThis.DragEvent).dataTransfer?.types.includes("Files")) event.preventDefault(); };
    window.addEventListener("dragover", stray);
    window.addEventListener("drop", stray);
    return () => {
      window.removeEventListener("dragover", stray);
      window.removeEventListener("drop", stray);
      uploadAbort.current?.abort();
    };
  }, []);
  const dropProps = {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = storageDown ? "none" : "copy";
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      setDragging(false);
      void startUploads(Array.from(event.dataTransfer.files));
    },
  };

  // ---- Choosing files ----

  const toggle = (id: string, range: boolean) => {
    // The anchor as it was at the click: the updater may run after it has moved on.
    const from = anchor.current;
    anchor.current = id;
    setSelected(current => toggleSelection(current, order, id, from, range));
  };
  const endSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    anchor.current = null;
  }, []);
  const selectAll = async () => {
    if (!listing) return;
    if (!listing.nextCursor) {
      setSelected(new Set(order));
      return;
    }
    setSelectingAll(true);
    const ticket = request.current;
    try {
      const { ids, total: all } = await agentApi.mediaIds(queryOf(viewRef.current));
      if (ticket !== request.current) return;
      setSelected(new Set(ids));
      if (all > ids.length) toast(`Selected the newest ${filesText(ids.length)} of ${count(all)}`, { description: "Delete these, then select the rest." });
    } catch (error) {
      toast.error("Couldn't select every file", { description: errorMessage(error) });
    } finally {
      setSelectingAll(false);
    }
  };
  // While choosing, a tile control the keyboard moves to never stays behind the bar at the bottom
  // (scroll-padding covers browsers that honour it when focusing; this covers the rest). The page
  // (.page, the shell's scroller) is what moves.
  useEffect(() => {
    const grid = gridRef.current;
    if (!selectionMode || !grid) return;
    const onFocus = (event: FocusEvent) => {
      const bar = barRef.current;
      if (!bar || !(event.target instanceof HTMLElement)) return;
      // Also for a control still below the screen: the browser scrolls a focused element into view only
      // after focusin, and finds nothing left to do once it already sits above the bar.
      const overlap = event.target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 12;
      if (overlap > 0) grid.closest(".page")?.scrollBy({ top: overlap, behavior: "instant" });
    };
    grid.addEventListener("focusin", onFocus);
    return () => grid.removeEventListener("focusin", onFocus);
  }, [selectionMode, listing]);

  // Esc ends choosing (an open dialog keeps Esc for itself).
  useEffect(() => {
    if (!selectionMode || confirmOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) endSelection(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode, confirmOpen, endSelection]);

  // ---- Deleting: one file, the chosen ones, or everything ----

  const blockedByStorage = () => {
    toast.error("Can't delete while storage is unavailable", { description: "Nothing was deleted. Try again once file storage is back." });
  };
  const askDelete = (file: MediaFile) => {
    // Removing needs storage (an elsewhere file is also cleared from this stage); a missing file's record can always go.
    if (file.state !== "missing" && storageDown) return blockedByStorage();
    setPending({ mode: "one", file });
    setConfirmOpen(true);
  };
  const askDeleteSelected = () => {
    if (!selected.size) return;
    if (storageDown) return blockedByStorage();
    setPending({ mode: "selected", ids: [...selected] });
    setConfirmOpen(true);
  };
  const askDeleteAll = () => {
    if (!total) return;
    if (storageDown) return blockedByStorage();
    setPending({ mode: "all", count: total, bytes: summary?.usedBytes ?? 0 });
    setConfirmOpen(true);
  };

  const dropLocally = (file: MediaFile) => {
    setListing(current => current && { ...current, files: current.files.filter(item => item.id !== file.id), matching: Math.max(0, current.matching - 1) });
    setVault(current => current && { ...current, summary: withoutFile(current.summary, file) });
    setSelected(current => {
      if (!current.has(file.id)) return current;
      const next = new Set(current);
      next.delete(file.id);
      return next;
    });
  };

  const removeOne = async (file: MediaFile) => {
    try {
      const result = await agentApi.removeMedia(file.id);
      dropLocally(file);
      refocusGrid.current = true;
      if (result.kept) toast.success(`Removed ${file.filename} from the list`, { description: "Its copy in the earlier storage location was not deleted there." });
      else toast.success(file.state === "stored" ? `Deleted ${file.filename}` : `Removed ${file.filename}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        dropLocally(file);
        refocusGrid.current = true;
        toast(`${file.filename} was already deleted`);
      } else if (error instanceof ApiError && error.status === 503) {
        toast.error("Can't delete while storage is unavailable", { description: "Nothing was deleted. Try again once file storage is back." });
      } else {
        toast.error(`Couldn't delete ${file.filename}`, { description: errorMessage(error) });
      }
    }
  };

  const send = (batch: string[]) => whileBusy(() => agentApi.removeMediaMany(batch), busyWait);
  /** The chosen files, or everything there is now (in rounds of at most MAX_SELECT_IDS; newer files stay). */
  const deleteTarget = async (target: Exclude<Pending, { mode: "one" }>): Promise<DeleteOutcome> => {
    if (target.mode === "selected") {
      setProgress({ done: 0, total: target.ids.length });
      return deleteInTurns(target.ids, send, done => setProgress({ done, total: target.ids.length }));
    }
    const outcome: DeleteOutcome = { deleted: [], kept: [], notFound: [], failed: [], skipped: [], stopped: null, error: null };
    for (let before = 0; ;) {
      const { ids, total: left } = await agentApi.mediaIds();
      if (!ids.length) return outcome;
      setProgress({ done: before, total: before + left });
      const round = await deleteInTurns(ids, send, done => setProgress({ done: before + done, total: before + left }));
      outcome.deleted.push(...round.deleted);
      outcome.kept.push(...round.kept);
      outcome.notFound.push(...round.notFound);
      outcome.failed.push(...round.failed);
      outcome.skipped.push(...round.skipped);
      outcome.stopped = round.stopped;
      outcome.error = round.error;
      before += ids.length;
      if (round.stopped || round.failed.length || goneCount(round) === 0 || left <= ids.length) return outcome;
    }
  };
  const removeMany = async (target: Exclude<Pending, { mode: "one" }>) => {
    let outcome: DeleteOutcome;
    try {
      outcome = await deleteTarget(target);
    } finally {
      setProgress(null);
    }
    const gone = goneCount(outcome);
    // Nothing happened at all: say why in the dialog, which stays open to try again.
    if (!gone && outcome.stopped) {
      throw new Error(outcome.stopped === "storage" ? "File storage isn't available right now, so nothing was deleted. Try again once it's back." : errorMessage(outcome.error, "Nothing was deleted. Try again."));
    }
    endSelection();
    refocusGrid.current = true;
    await load();
    const kept = outcome.kept.length;
    const keptNote = kept ? `${filesText(kept)} ${kept === 1 ? "was" : "were"} in an earlier storage location; ${kept === 1 ? "its copy" : "their copies"} there ${kept === 1 ? "wasn't" : "weren't"} deleted.` : undefined;
    const notGone = outcome.failed.length;
    if (outcome.stopped === "storage") {
      toast.error("File storage became unavailable", { description: `${filesText(gone)} deleted; the rest weren't. Try again once it's back.` });
    } else if (notGone || outcome.stopped) {
      const reason = outcome.failed[0]?.error ?? errorMessage(outcome.error);
      toast.error(notGone ? `Couldn't delete ${filesText(notGone)}` : "Deleting stopped early", { description: `${filesText(gone)} deleted. ${reason}` });
    } else {
      toast.success(`Deleted ${filesText(gone)}`, keptNote ? { description: keptNote } : undefined);
    }
  };

  const confirmDelete = () => {
    if (!pending) return;
    return pending.mode === "one" ? removeOne(pending.file) : removeMany(pending);
  };

  // The deleted tiles (and their buttons) are gone: keep focus in the grid instead of losing it to the page.
  useEffect(() => {
    if (confirmOpen || !refocusGrid.current) return;
    refocusGrid.current = false;
    const timer = setTimeout(() => gridRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(timer);
  }, [confirmOpen]);

  const actions: TopbarAction[] = [
    {
      id: "upload",
      label: "Upload",
      icon: Upload,
      priority: "primary",
      tone: "accent",
      disabled: storageDown,
      title: storageDown ? "Uploads are paused while file storage is unavailable" : "Upload files, up to 25 MB each (pick or drop several at once)",
      onSelect: () => input.current?.click(),
    },
    {
      id: "delete-all",
      label: "Delete all files…",
      icon: Trash2,
      priority: "overflow",
      tone: "danger",
      disabled: !total || storageDown,
      title: !total ? "Your Media Vault is empty" : storageDown ? "Can't delete while storage is unavailable" : `Every file in your Media Vault (${filesText(total)})`,
      onSelect: askDeleteAll,
    },
  ];

  const dialog = dialogText(pending, progress);

  return (
    <AppShell title="Media Vault" topbarActions={actions}>
      <input ref={input} type="file" multiple hidden onChange={event => { void startUploads(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <div className="page vault-page" {...dropProps}>
        {dragging && (
          <div className="vault-drop" aria-hidden="true">
            <Upload size={22} />
            <span>{storageDown ? "Uploads are paused while file storage is unavailable" : "Drop files to upload them"}</span>
          </div>
        )}
        <div className="page-wide">
          <header className="page-head">
            <div>
              <span className="eyebrow">Files</span>
              <h2 className="page-title">Media Vault</h2>
              <p className="page-sub">Uploads, screenshots and files from your tasks, kept in Curialy Vault. Files open through short-lived links.</p>
            </div>
            {vault && <VaultUsage summary={vault.summary} quota={vault.quota} />}
          </header>

          {storageDown && <StorageNotice setup={setup} />}
          {uploads.length > 0 && (
            <UploadPanel
              items={uploads}
              running={uploadsRunning}
              onCancel={() => uploadAbort.current?.abort()}
              onRetry={retryFailed}
              onDismiss={() => setUploads([])}
            />
          )}

          {listing === null ? (
            loadError ? (
              <div className="card">
                <StateNotice variant="error" title="Couldn't load your files" actions={<Button variant="primary" icon={RotateCcw} onClick={() => void load()}>Try again</Button>}>{loadError}</StateNotice>
              </div>
            ) : (
              <VaultSkeleton />
            )
          ) : total === 0 && !filtered ? (
            <div className="card">
              <StateNotice
                variant="empty"
                icon={Images}
                size="lg"
                title="No files yet"
                actions={<Button variant="primary" icon={Upload} onClick={() => (storageDown ? toast.error("Uploads are paused", { description: "File storage isn't available right now." }) : input.current?.click())}>Upload files</Button>}
              >
                Pick or drop several files at once, attach them in the composer, or let the agent take screenshots with the Live Browser. Files that finished tasks produce show up here too.
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
                  <ToggleGroup.Root type="single" className="segmented pg-filters" aria-label="Show" value={view.kind} onValueChange={value => value && setView(current => ({ ...current, kind: value as KindFilter }))}>
                    {KINDS.map(item => (
                      <ToggleGroup.Item key={item.id} value={item.id} aria-label={`${item.label}, ${counts[item.id]}`}>
                        {item.label}
                        <span className="pg-count" aria-hidden="true">{count(counts[item.id])}</span>
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
                <Button className="vault-select-toggle" icon={selectionMode ? X : ListChecks} aria-pressed={selectionMode} disabled={!files.length && !selectionMode} onClick={() => (selectionMode ? endSelection() : setSelecting(true))}>
                  {selectionMode ? "Done" : "Select"}
                </Button>
              </div>
              <div className="pg-statusline">
                <p role="status">
                  {view.q ? `${filesText(matching)} matching “${view.q}”` : filtered ? filesText(matching) : filesText(total)}
                  {files.length < matching ? ` · showing the newest ${count(files.length)}` : ""}
                </p>
              </div>
              {files.length === 0 ? (
                <div className="card">
                  <StateNotice variant="empty" title={view.q ? `No files match “${view.q}”` : KINDS.find(item => item.id === view.kind)!.empty} actions={<Button onClick={() => { setQuery(""); setView({ kind: "all", q: "" }); }}>Show all files</Button>}>
                    {view.q ? "Try another name, or clear the search." : "Pick another kind to see the rest."}
                  </StateNotice>
                </div>
              ) : (
                <>
                  <ul className="vault-grid" ref={gridRef} tabIndex={-1} aria-label="Files" data-selecting={selectionMode || undefined}>
                    {files.map(file => (
                      <VaultTile key={file.id} file={file} storageDown={storageDown} selectionMode={selectionMode} selected={selected.has(file.id)} onToggle={toggle} onDelete={askDelete} />
                    ))}
                  </ul>
                  {listing.nextCursor && (
                    <div className="vault-more">
                      <Button busy={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Show more"}</Button>
                      <p className="field-hint">{count(files.length)} of {filesText(matching)} shown</p>
                    </div>
                  )}
                </>
              )}
              {selectionMode && (
                <section className="vault-selbar" ref={barRef} aria-label="Chosen files">
                  <p className="vault-selbar-count" aria-live="polite">{selected.size ? `${count(selected.size)} selected` : "Choose files, or select them all"}</p>
                  <div className="vault-selbar-actions">
                    {selected.size < matching && (
                      <Button size="sm" variant="ghost" icon={CheckCheck} busy={selectingAll} onClick={() => void selectAll()}>Select all {count(matching)}</Button>
                    )}
                    {selected.size > 0 && <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); anchor.current = null; }}>Clear</Button>}
                    <Button size="sm" variant="danger" icon={Trash2} disabled={!selected.size} onClick={askDeleteSelected}>
                      Delete{selected.size ? ` ${count(selected.size)}` : ""}
                    </Button>
                    <IconButton size="sm" label="Stop selecting" icon={X} onClick={endSelection} />
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={dialog.title}
        confirmLabel={dialog.confirm}
        busyLabel={dialog.busy}
        tone="danger"
        onConfirm={confirmDelete}
      >
        {dialog.body}
      </ConfirmDialog>
    </AppShell>
  );
}

function dialogText(pending: Pending | null, progress: { done: number; total: number } | null) {
  const busy = progress && progress.total > 1 ? `Deleting ${count(progress.done)} of ${count(progress.total)}…` : "Deleting…";
  if (!pending) return { title: "Delete this file?", confirm: "Delete file", busy, body: null };
  if (pending.mode === "one") {
    const file = pending.file;
    const gone = file.state !== "stored";
    return {
      title: gone ? `Remove ${file.filename}?` : `Delete ${file.filename}?`,
      confirm: gone ? "Remove" : "Delete file",
      busy: gone ? "Removing…" : "Deleting…",
      body: file.state === "missing"
        ? "The file itself is already gone from storage; this removes it from the list."
        : file.state === "elsewhere"
          ? "This file is in an earlier storage location this server no longer reads. Removing it deletes its record here; the copy there is not deleted."
          : "The file is removed from storage for good. Tasks that used it keep their history, but can no longer show or download it.",
    };
  }
  if (pending.mode === "selected") {
    const n = pending.ids.length;
    return {
      title: `Delete ${filesText(n)}?`,
      confirm: n === 1 ? "Delete file" : `Delete ${filesText(n)}`,
      busy,
      body: `${n === 1 ? "It is" : "They are"} removed from storage for good. Tasks that used ${n === 1 ? "it" : "them"} keep their history, but can no longer show or download ${n === 1 ? "it" : "them"}.`,
    };
  }
  return {
    title: `Delete all ${filesText(pending.count)}?`,
    confirm: "Delete all files",
    busy,
    body: `Every file in your Media Vault (${formatBytes(pending.bytes)}) is removed from storage for good: uploads, screenshots and files from tasks. Tasks keep their history, but can no longer show or download them. This can't be undone.`,
  };
}

/** How much the vault holds against its limit; a plan's (and the operator's) has none. */
function VaultUsage({ summary, quota }: { summary: VaultSummary; quota: VaultQuota }) {
  if (quota.unlimited) {
    return (
      <div className="vault-usage" data-unlimited="">
        <p className="vault-usage-line">{formatBytes(summary.usedBytes)} · {filesText(summary.usedFiles)}</p>
        <p className="vault-usage-note">{quota.reason === "plan" && quota.plan ? `Unlimited storage with ${quota.plan}` : "Unlimited storage"}</p>
      </div>
    );
  }
  const maxBytes = quota.maxBytes ?? FREE_VAULT_BYTES;
  const maxFiles = quota.maxFiles ?? FREE_VAULT_FILES;
  const share = Math.min(1, Math.max(summary.usedBytes / maxBytes, summary.usedFiles / maxFiles));
  const full = vaultFull(summary, quota);
  return (
    <div className="vault-usage" data-tone={full ? "danger" : share >= 0.8 ? "warning" : undefined}>
      <p className="vault-usage-line">
        <span>{formatBytes(summary.usedBytes)} of {formatBytes(maxBytes)}</span>
        <span>{count(summary.usedFiles)} of {count(maxFiles)} files</span>
      </p>
      <span className="vault-meter" aria-hidden="true"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
      <p className="vault-usage-note">
        {full ? "Your vault is full: delete files, or get a plan for unlimited storage. " : "Plans have unlimited storage. "}
        <Link href="/billing">See plans</Link>
      </p>
    </div>
  );
}

function UploadPanel({ items, running, onCancel, onRetry, onDismiss }: { items: UploadItem[]; running: boolean; onCancel: () => void; onRetry: () => void; onDismiss: () => void }) {
  const done = items.filter(item => item.state === "done").length;
  const failed = items.filter(item => item.state === "failed").length;
  const cancelled = items.filter(item => item.state === "cancelled").length;
  const retryable = items.some(item => item.state === "failed" && item.retryable);
  const title = running
    ? `Uploading ${count(Math.min(items.length, done + failed + cancelled + 1))} of ${count(items.length)}`
    : failed || cancelled
      ? `${filesText(done)} uploaded, ${count(failed + cancelled)} not`
      : `Uploaded ${filesText(done)}`;
  return (
    <section className="card vault-uploads" aria-label="Uploads">
      <div className="vault-uploads-head">
        <p className="vault-uploads-title" role="status">{title}</p>
        <div className="vault-uploads-actions">
          {running ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          ) : (
            <>
              {retryable && <Button size="sm" icon={RotateCcw} onClick={onRetry}>Retry</Button>}
              <IconButton size="sm" label="Close the upload list" icon={X} onClick={onDismiss} />
            </>
          )}
        </div>
      </div>
      <ul className="vault-uploads-list">
        {items.map(item => {
          const percent = item.file.size ? Math.min(100, Math.round((item.sent / item.file.size) * 100)) : 100;
          const state = item.state === "waiting" ? (item.waitingOnOthers ? "Waiting for your other uploads…" : "Waiting")
            : item.state === "uploading" ? `${percent}%`
              : item.state === "saving" ? "Saving…"
                : item.state === "done" ? "Uploaded"
                  : item.state === "cancelled" ? "Cancelled"
                    : item.error ?? "Not uploaded";
          return (
            <li key={item.key} className="vault-upload" data-state={item.state}>
              <span className="vault-upload-name truncate" title={item.file.name}>{item.file.name}</span>
              <span className="vault-upload-size">{formatBytes(item.file.size)}</span>
              <span className="vault-upload-state">{state}</span>
              {(item.state === "uploading" || item.state === "saving") && (
                <span className="vault-upload-bar" aria-hidden="true"><span style={{ width: `${item.state === "saving" ? 100 : percent}%` }} /></span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
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

function ThumbContent({ file }: { file: MediaFile }) {
  const Glyph = fileGlyph(file);
  const ext = extension(file.filename);
  if (file.state !== "stored") {
    return (
      <span className="vault-glyph">
        <ImageOff size={20} aria-hidden="true" />
        <span className="vault-glyph-label">{file.state === "elsewhere" ? "In an earlier storage location" : "No longer available"}</span>
      </span>
    );
  }
  if (file.mimeType.startsWith("image/")) return <MediaImage id={file.id} alt={file.filename} mime={file.mimeType} variant="thumb" />;
  return (
    <span className="vault-glyph">
      <Glyph size={24} aria-hidden="true" />
      {ext && <span className="vault-ext">{ext}</span>}
    </span>
  );
}

function VaultTile({ file, storageDown, selectionMode, selected, onToggle, onDelete }: {
  file: MediaFile;
  storageDown: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggle: (id: string, range: boolean) => void;
  onDelete: (file: MediaFile) => void;
}) {
  // Missing (gone) and elsewhere (in an earlier storage account) both have nothing to show here.
  const missing = file.state !== "stored";
  return (
    <li className="card vault-tile" data-state={file.state} data-selected={selected || undefined}>
      {/* The checkbox is the control (keyboard and screen readers); while choosing, the picture toggles it too. */}
      <input type="checkbox" className="vault-check" checked={selected} onChange={() => undefined} onClick={event => onToggle(file.id, event.shiftKey)} aria-label={`Select ${file.filename}`} />
      {selectionMode ? (
        <div className="vault-thumb" data-empty={missing ? "" : undefined} data-pick="" onClick={event => onToggle(file.id, event.shiftKey)}>
          <ThumbContent file={file} />
        </div>
      ) : missing ? (
        <span className="vault-thumb" data-empty="">
          <ThumbContent file={file} />
        </span>
      ) : (
        <MediaLink id={file.id} filename={file.filename} className="vault-thumb" aria-label={`Open ${file.filename}`}>
          <ThumbContent file={file} />
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
