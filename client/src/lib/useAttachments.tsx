import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Paperclip, X } from "lucide-react";
import { agentApi, type UploadedFile } from "@/lib/api";
import { mediaHealth } from "@/lib/mediaHealth";
import { Spinner } from "@/components/common/Spinner";

// Shared attachment handling for the new-task composer and the follow-up bar: picker, paste
// (Ctrl/Cmd+V screenshots) and drag & drop, uploading straight to Curialy Vault.

export const MAX_ATTACHMENTS = 10;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type PendingAttachment = UploadedFile & { previewUrl?: string };

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");

/** Pasted screenshots arrive as "image.png"; give them a distinguishable name. */
function named(file: File) {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file;
  const ext = file.name.split(".").pop();
  return new File([file], `screenshot-${stamp()}.${ext}`, { type: file.type });
}

export function useAttachments() {
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Slots are claimed synchronously when a batch is accepted, so overlapping picks/pastes/drops
  // cannot exceed the limit while earlier uploads are still in flight.
  const claimed = useRef(0);
  const filesRef = useRef<PendingAttachment[]>([]);
  filesRef.current = files;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // Drops that miss the composer would otherwise navigate the tab to the file.
    const stray = (event: Event) => { if ((event as globalThis.DragEvent).dataTransfer?.types.includes("Files")) event.preventDefault(); };
    window.addEventListener("dragover", stray);
    window.addEventListener("drop", stray);
    return () => {
      mounted.current = false;
      window.removeEventListener("dragover", stray);
      window.removeEventListener("drop", stray);
      filesRef.current.forEach(file => file.previewUrl && URL.revokeObjectURL(file.previewUrl));
    };
  }, []);

  const add = async (list: FileList | File[] | null) => {
    if (!list) return;
    setError(null);
    // While file storage is known to be down an upload can only fail; say so instead of trying.
    if (mediaHealth.get().status === "unavailable") {
      setError("File storage isn't available right now, so files can't be attached. You can still send your message without them.");
      return;
    }
    const incoming = Array.from(list);
    const room = Math.max(0, MAX_ATTACHMENTS - claimed.current);
    if (incoming.length > room) setError(`Up to ${MAX_ATTACHMENTS} files per message.`);
    const accepted = incoming.slice(0, room);
    claimed.current += accepted.length;
    await Promise.all(accepted.map(async raw => {
      const file = named(raw);
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name} is larger than 25 MB.`);
        claimed.current--;
        return;
      }
      setUploading(value => value + 1);
      try {
        const uploaded = await agentApi.upload(file);
        if (!mounted.current) return;
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        setFiles(current => [...current, { ...uploaded, previewUrl }]);
      } catch (uploadError) {
        claimed.current--;
        setError(`${file.name}: ${uploadError instanceof Error ? uploadError.message : "upload failed"}`);
      } finally {
        if (mounted.current) setUploading(value => value - 1);
      }
    }));
  };

  /** Remove the given files (default: all). Files added after a send started are kept. */
  const removeMany = (ids?: string[]) => setFiles(current => {
    const drop = current.filter(file => !ids || ids.includes(file.id));
    drop.forEach(file => file.previewUrl && URL.revokeObjectURL(file.previewUrl));
    claimed.current = Math.max(0, claimed.current - drop.length);
    return current.filter(file => !drop.includes(file));
  });
  const remove = (id: string) => removeMany([id]);
  const clear = (ids?: string[]) => { removeMany(ids); setError(null); };

  const onPaste = (event: ClipboardEvent) => {
    const pasted = Array.from(event.clipboardData?.files ?? []);
    if (!pasted.length) return; // plain text paste: leave it alone
    // Spreadsheet/document cells put both text and a rendered image on the clipboard; keep the text.
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.trim() && pasted.every(file => file.type.startsWith("image/"))) return;
    event.preventDefault();
    void add(pasted);
  };

  const dropProps = {
    onDragOver: (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); setDragging(true); } },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); },
    onDrop: (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      setDragging(false);
      void add(event.dataTransfer.files);
    },
  };

  const picker = <input ref={inputRef} type="file" multiple hidden onChange={event => { void add(event.target.files); event.target.value = ""; }} />;
  const open = () => inputRef.current?.click();

  return { files, ids: files.map(file => file.id), uploading, error, setError, dragging, add, remove, clear, onPaste, dropProps, picker, open, full: files.length + uploading >= MAX_ATTACHMENTS };
}

export function AttachmentTray({ files, uploading, onRemove }: { files: PendingAttachment[]; uploading: number; onRemove: (id: string) => void }) {
  if (!files.length && !uploading) return null;
  return (
    <div className="composer-attachments">
      {files.map(file => (
        <span key={file.id} className={`chip att-chip${file.previewUrl ? " has-thumb" : ""}`} title={file.filename}>
          {file.previewUrl ? <img src={file.previewUrl} alt="" /> : <Paperclip size={11} aria-hidden="true" />}
          <span className="truncate att-chip-name">{file.filename}</span>
          <button type="button" aria-label={`Remove ${file.filename}`} onClick={() => onRemove(file.id)}><X size={11} aria-hidden="true" /></button>
        </span>
      ))}
      {uploading > 0 && <span className="chip" role="status"><Spinner size={11} /> Uploading{uploading > 1 ? ` ${uploading}` : ""}…</span>}
    </div>
  );
}
