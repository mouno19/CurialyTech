import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { Download, File, FileImage, Folder, FolderOpen, Maximize2, Minimize2, RefreshCcw, SquareTerminal } from "lucide-react";
import { highlight, languageForPath } from "@/lib/highlight";

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

type ViewedFile = { path: string; bytes: number; kind: "text" | "image" | "binary"; content: string; truncated?: boolean };
import type { AgentTaskSummary } from "@shared/agent";
import { AppShell, EmptyState } from "@/components/shell/AppShell";
import { agentApi, formatBytes, type TreeEntry } from "@/lib/api";

export default function Sandbox() {
  const search = useSearch();
  const initial = new URLSearchParams(search).get("task");
  const [tasks, setTasks] = useState<AgentTaskSummary[]>([]);
  const [taskId, setTaskId] = useState<string | null>(initial);
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [source, setSource] = useState<"live" | "archived" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<ViewedFile | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    agentApi.tasks().then(data => {
      const coding = data.tasks.filter(task => task.mode === "agent");
      setTasks(coding);
      setTaskId(current => current ?? coding[0]?.id ?? null);
    }).catch(() => setTasks([]));
  }, []);

  const loadTree = () => {
    if (!taskId) return;
    setEntries(null);
    agentApi.tree(taskId).then(data => { setEntries(data.entries); setSource(data.source); }).catch(treeError => setError(treeError.message));
  };
  useEffect(() => { setSelected(null); setFile(null); loadTree(); }, [taskId]);

  useEffect(() => {
    if (!taskId || !selected) return;
    setError(null);
    setImageError(false);
    setActualSize(false);
    // Images are rendered from the raw endpoint; only text is fetched as JSON.
    if (IMAGE_FILE.test(selected)) {
      const entry = entries?.find(item => item.path === selected);
      setFile({ path: selected, bytes: entry?.size ?? 0, kind: "image", content: "" });
      return;
    }
    agentApi.file(taskId, selected)
      .then(data => setFile({ path: data.path, bytes: data.bytes, kind: data.binary ? "binary" : "text", content: data.content, truncated: data.truncated }))
      .catch(fileError => { setFile(null); setError(fileError.message); });
  }, [taskId, selected]);

  const visible = useMemo(() => (entries ?? []).filter(entry => !Array.from(collapsed).some(dir => entry.path.startsWith(`${dir}/`))), [entries, collapsed]);
  const toggle = (dir: string) => setCollapsed(current => {
    const next = new Set(current);
    if (next.has(dir)) next.delete(dir); else next.add(dir);
    return next;
  });

  return (
    <AppShell title="Code Sandbox" actions={taskId ? <Link href={`/tasks/${taskId}`} className="btn sm"><SquareTerminal size={13} /> Open task</Link> : undefined}>
      <div className="page">
        <p className="page-sub">While a task is active its files live in a scratch workspace on the server (unprivileged <code>curialy-agent</code> user, memory/CPU/network limits). After an hour idle the scratch copy is removed; the durable snapshot lives in Tiger and is restored on follow-up.</p>
        {tasks.length === 0 ? <div className="card"><EmptyState icon={FolderOpen} title="No workspaces yet">Run an Agent-mode task to create one.</EmptyState></div> : (
          <div className="card">
            <div className="card-head">
              <select className="input" style={{ maxWidth: 520, height: 30 }} value={taskId ?? ""} onChange={event => setTaskId(event.target.value)}>
                {tasks.map(task => <option key={task.id} value={task.id}>{task.prompt.slice(0, 90)}</option>)}
              </select>
              {source && <span className={`chip ${source === "live" ? "mint" : ""}`}>{source === "live" ? "live scratch" : "archived in Tiger"}</span>}
              <button className="icon-btn" onClick={loadTree} title="Refresh"><RefreshCcw size={14} /></button>
            </div>
            <div className="explorer">
              <div className="tree">
                {entries === null && <div className="faint" style={{ padding: 10 }}>Loading…</div>}
                {entries?.length === 0 && <div className="faint" style={{ padding: 10 }}>Empty workspace</div>}
                {visible.map(entry => {
                  const depth = entry.path.split("/").length - 1;
                  const name = entry.path.split("/").pop();
                  return entry.type === "dir" ? (
                    <button key={entry.path} className="tree-item" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => toggle(entry.path)}>
                      {collapsed.has(entry.path) ? <Folder size={13} color="var(--violet)" /> : <FolderOpen size={13} color="var(--violet)" />} {name}
                    </button>
                  ) : (
                    <button key={entry.path} className={`tree-item${selected === entry.path ? " on" : ""}`} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => setSelected(entry.path)}>
                      <File size={13} className="faint" /> <span className="truncate">{name}</span><small>{formatBytes(entry.size)}</small>
                    </button>
                  );
                })}
              </div>
              <div style={{ minWidth: 0 }}>
                {error && <div className="alert error" style={{ margin: 10 }}>{error}</div>}
                {file ? (
                  <>
                    <div className="diff-head">
                      <span className="diff-path">{file.path}</span>
                      <span className="chip mono">{formatBytes(file.bytes)}</span>
                      <span className="spacer" />
                      <a className="btn sm" href={agentApi.downloadUrl(taskId!, file.path)}><Download size={13} /> Download</a>
                    </div>
                    {file.kind === "image" && (
                      <div className={`image-view${actualSize ? " actual" : ""}`}>
                        {imageError ? (
                          <EmptyState icon={FileImage} title="This image could not be displayed">It may be corrupt or in a format the browser cannot render. Use Download to inspect it.</EmptyState>
                        ) : (
                          <img src={agentApi.rawFileUrl(taskId!, file.path)} alt={file.path.split("/").pop()} onError={() => setImageError(true)} onClick={() => setActualSize(value => !value)} title={actualSize ? "Click to fit" : "Click for actual size"} />
                        )}
                        <div className="image-meta">
                          {file.path.split("/").pop()} · {formatBytes(file.bytes)}
                          {!imageError && <button className="icon-btn sm" onClick={() => setActualSize(value => !value)} title={actualSize ? "Fit to panel" : "Actual size"}>{actualSize ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
                        </div>
                      </div>
                    )}
                    {file.kind === "binary" && <EmptyState icon={File} title="Binary file">{formatBytes(file.bytes)} of binary data can't be shown as text. Use Download to open it.</EmptyState>}
                    {file.kind === "text" && (
                      <div className="code-view">
                        {file.truncated && <div className="alert warn" style={{ borderRadius: 0 }}>Showing the first 2 MB.</div>}
                        <table><tbody>{file.content.split("\n").map((line, index) => <tr key={index}><td className="ln">{index + 1}</td><td dangerouslySetInnerHTML={{ __html: line ? highlight(line, languageForPath(file.path)) : " " }} /></tr>)}</tbody></table>
                      </div>
                    )}
                  </>
                ) : !error && <EmptyState icon={File} title="Select a file">Pick a file from the tree to inspect it.</EmptyState>}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
