import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { Download, File, Folder, FolderOpen, RefreshCcw, SquareTerminal } from "lucide-react";
import type { AgentTaskSummary } from "@shared/agent";
import { AppShell, EmptyState } from "@/components/shell/AppShell";
import { agentApi, formatBytes, type TreeEntry } from "@/lib/api";

export default function Sandbox() {
  const search = useSearch();
  const initial = new URLSearchParams(search).get("task");
  const [tasks, setTasks] = useState<AgentTaskSummary[]>([]);
  const [taskId, setTaskId] = useState<string | null>(initial);
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; content: string; bytes: number } | null>(null);
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
    agentApi.tree(taskId).then(data => setEntries(data.entries)).catch(treeError => setError(treeError.message));
  };
  useEffect(() => { setSelected(null); setFile(null); loadTree(); }, [taskId]);

  useEffect(() => {
    if (!taskId || !selected) return;
    setError(null);
    agentApi.file(taskId, selected).then(setFile).catch(fileError => { setFile(null); setError(fileError.message); });
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
        <p className="page-sub">Each agent task has an isolated workspace at <code>/srv/curialy-workspaces/&lt;task&gt;</code>. Commands run as the unprivileged <code>curialy-agent</code> user with memory, CPU and network limits.</p>
        {tasks.length === 0 ? <div className="card"><EmptyState icon={FolderOpen} title="No workspaces yet">Run an Agent-mode task to create one.</EmptyState></div> : (
          <div className="card">
            <div className="card-head">
              <select className="input" style={{ maxWidth: 520, height: 30 }} value={taskId ?? ""} onChange={event => setTaskId(event.target.value)}>
                {tasks.map(task => <option key={task.id} value={task.id}>{task.prompt.slice(0, 90)}</option>)}
              </select>
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
                    <div className="code-view">
                      <table><tbody>{file.content.split("\n").map((line, index) => <tr key={index}><td className="ln">{index + 1}</td><td>{line || " "}</td></tr>)}</tbody></table>
                    </div>
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
