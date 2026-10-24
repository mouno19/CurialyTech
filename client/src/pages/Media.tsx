import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { AppShell, EmptyState } from "@/components/shell/AppShell";
import { agentApi, formatBytes, relativeTime, type MediaFile } from "@/lib/api";

export default function Media() {
  const [files, setFiles] = useState<MediaFile[] | null>(null);
  const [stage, setStage] = useState<{ ok: boolean; detail: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () => agentApi.media().then(data => { setFiles(data.files); setStage(data.stage); }).catch(loadError => { setFiles([]); setError(loadError.message); });
  useEffect(() => { void load(); }, []);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(list)) await agentApi.upload(file);
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <AppShell title="Media Vault" actions={<button className="btn primary sm" disabled={!stage?.ok || uploading} onClick={() => input.current?.click()}>{uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} Upload</button>}>
      <input ref={input} type="file" multiple hidden onChange={event => { void upload(event.target.files); event.target.value = ""; }} />
      <div className="page">
        <div className="page-narrow">
          <p className="page-sub">Uploads, screenshots and artifacts live in the Snowflake stage <code>@CURIALY_DB.PUBLIC.USER_MEDIA_STAGE</code>. Bytes stream from memory to Snowflake and are viewed through short-lived presigned URLs; nothing is kept on the server's disk.</p>
          {stage && !stage.ok && <div className="alert warn" style={{ marginBottom: 16 }}>Media stage not ready: {stage.detail}. Run the setup SQL as ACCOUNTADMIN, then reload.</div>}
          {error && <div className="alert error" style={{ marginBottom: 16 }}>{error}</div>}
          {files === null ? <div className="empty">Loading…</div> : files.length === 0 ? (
            <div className="card"><EmptyState icon={ImageIcon} title="No media yet">Attach files in the composer, or let the agent take Browserbase screenshots.</EmptyState></div>
          ) : (
            <div className="media-grid">
              {files.map(file => (
                <div key={file.id} className="card media-tile">
                  <a className="thumb" href={agentApi.mediaUrl(file.id)} target="_blank" rel="noreferrer">
                    {file.mimeType.startsWith("image/") ? <img src={agentApi.mediaUrl(file.id)} alt={file.filename} loading="lazy" /> : <FileText size={28} className="faint" />}
                  </a>
                  <div className="card-pad" style={{ padding: "10px 12px" }}>
                    <div className="row"><span className="truncate" style={{ fontSize: 12.5 }}>{file.filename}</span><span className="spacer" />
                      <button className="icon-btn sm" title="Delete" onClick={() => { if (confirm(`Delete ${file.filename}?`)) void agentApi.removeMedia(file.id).then(load); }}><Trash2 size={13} /></button>
                    </div>
                    <div className="faint" style={{ fontSize: 11 }}>{file.kind} · {formatBytes(file.sizeBytes)} · {relativeTime(file.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
