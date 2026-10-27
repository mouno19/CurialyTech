import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Link, useSearch } from "wouter";
import * as Popover from "@radix-ui/react-popover";
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Download, ExternalLink, File as FileIcon, FileCode2, FileImage, FileText, Folder, FolderOpen, Layers, Plus, RefreshCw, RotateCcw, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import type { AgentTaskSummary } from "@shared/agent";
import { isGeneratedPath } from "@shared/generated";
import { AppShell, type TopbarAction } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { PathLabel } from "@/components/common/PathLabel";
import { StateNotice } from "@/components/common/StateNotice";
import { StatusBadge } from "@/components/common/StatusBadge";
import { MediaImage } from "@/components/MediaImage";
import { Combobox, POPOVER_COLLISION } from "@/components/RepoSelector";
import { agentApi, ApiError, errorMessage, formatBytes, relativeTime, type TreeEntry } from "@/lib/api";
import { highlight, languageForPath } from "@/lib/highlight";
import { firstLine } from "./Tasks";

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift|sh|sql|css|scss|html?|vue|svelte|json|ya?ml|toml)$/i;
/** The live listing skips these folders' contents (they are listed, not walked). */
const UNLISTED = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".venv", "venv", ".cache"]);
const LINE_LIMIT = 4000;
const SMALL_TREE = 400;

// ---------------------------------------------------------------------------------------------
// Tree model: entries (live listing or archived copy, in any order) to a sorted hierarchy
// ---------------------------------------------------------------------------------------------

type TreeNode = {
  path: string;
  name: string;
  type: "dir" | "file";
  size: number;
  depth: number;
  children: TreeNode[];
  /** Build output: a generated file, or a folder holding only generated files. */
  generated: boolean;
  fileCount: number;
};

function buildTree(entries: TreeEntry[]): TreeNode[] {
  const root: TreeNode = { path: "", name: "", type: "dir", size: 0, depth: -1, children: [], generated: false, fileCount: 0 };
  const byPath = new Map<string, TreeNode>([["", root]]);
  const dir = (path: string): TreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const cut = path.lastIndexOf("/");
    const parent = dir(cut >= 0 ? path.slice(0, cut) : "");
    const node: TreeNode = { path, name: path.slice(cut + 1), type: "dir", size: 0, depth: parent.depth + 1, children: [], generated: false, fileCount: 0 };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!path || path === ".") continue;
    if (entry.type === "dir") {
      dir(path);
      continue;
    }
    if (byPath.has(path)) continue;
    const cut = path.lastIndexOf("/");
    const parent = dir(cut >= 0 ? path.slice(0, cut) : "");
    const node: TreeNode = { path, name: path.slice(cut + 1), type: "file", size: entry.size, depth: parent.depth + 1, children: [], generated: isGeneratedPath(path), fileCount: 1 };
    parent.children.push(node);
    byPath.set(path, node);
  }
  const finish = (node: TreeNode) => {
    if (node.type === "file") return;
    let files = 0;
    let allGenerated = true;
    for (const child of node.children) {
      finish(child);
      files += child.fileCount;
      if (!child.generated) allGenerated = false;
    }
    node.fileCount = files;
    node.generated = node !== root && files > 0 && allGenerated;
    node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.type === "dir" ? -1 : 1));
  };
  finish(root);
  return root.children;
}

function countFiles(nodes: TreeNode[]) {
  let files = 0;
  let generated = 0;
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type === "file") {
        files += 1;
        if (node.generated) generated += 1;
      } else walk(node.children);
    }
  };
  walk(nodes);
  return { files, generated };
}

/** Small trees open fully; large ones show the top level. Build output starts collapsed. */
function defaultExpanded(nodes: TreeNode[], total: number, selected: string | null) {
  const open = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type !== "dir" || node.generated) continue;
      if (total <= SMALL_TREE || node.depth === 0) open.add(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  if (selected) {
    const parts = selected.split("/");
    for (let index = 1; index < parts.length; index++) open.add(parts.slice(0, index).join("/"));
  }
  return open;
}

type FlatItem = { node: TreeNode; setsize: number; posinset: number; parent: string | null };

function flatten(nodes: TreeNode[], expanded: Set<string>, hideGenerated: boolean, parent: string | null = null, out: FlatItem[] = []) {
  const list = hideGenerated ? nodes.filter(node => !node.generated) : nodes;
  list.forEach((node, index) => {
    out.push({ node, setsize: list.length, posinset: index + 1, parent });
    if (node.type === "dir" && expanded.has(node.path)) flatten(node.children, expanded, hideGenerated, node.path, out);
  });
  return out;
}

const fileIcon = (name: string) => (IMAGE_FILE.test(name) ? FileImage : CODE_FILE.test(name) ? FileCode2 : /\.(md|txt|rst|log)$/i.test(name) ? FileText : FileIcon);

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

type TreeState = { taskId: string; entries: TreeEntry[]; source: "live" | "archived" };

export default function Sandbox() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [tasks, setTasks] = useState<AgentTaskSummary[] | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(() => params.get("task"));
  const [selected, setSelected] = useState<string | null>(() => params.get("path"));
  const [tree, setTree] = useState<TreeState | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [hideGenerated, setHideGenerated] = useState(false);
  const treeToken = useRef(0);
  const expandedFor = useRef<string | null>(null);

  const loadTasks = useCallback(() => {
    setTasksError(null);
    agentApi.tasks().then(
      data => {
        const coding = data.tasks.filter(task => task.mode === "agent");
        setTasks(coding);
        setTaskId(current => current ?? coding[0]?.id ?? null);
      },
      error => setTasksError(errorMessage(error, "Couldn't load your tasks.")),
    );
  }, []);
  useEffect(() => loadTasks(), [loadTasks]);

  const loadTree = useCallback(async (id: string, keep = false) => {
    const token = ++treeToken.current;
    setTreeLoading(true);
    setTreeError(null);
    if (!keep) setTree(null);
    try {
      const data = await agentApi.tree(id);
      if (token === treeToken.current) setTree({ taskId: id, entries: data.entries, source: data.source });
    } catch (error) {
      if (token !== treeToken.current) return;
      setTreeError(error instanceof ApiError && error.status === 404 ? "This task doesn't exist any more." : errorMessage(error, "Couldn't load the workspace files."));
    } finally {
      if (token === treeToken.current) setTreeLoading(false);
    }
  }, []);
  useEffect(() => {
    if (taskId) void loadTree(taskId);
  }, [taskId, loadTree]);

  // The URL names the task and file (shareable, survives a reload); a link to another task switches to it.
  useEffect(() => {
    const linked = params.get("task");
    if (linked && linked !== taskId) {
      setTaskId(linked);
      setSelected(params.get("path"));
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!taskId) return;
    const next = new URLSearchParams({ task: taskId, ...(selected ? { path: selected } : {}) });
    if (window.location.search !== `?${next}`) window.history.replaceState(window.history.state, "", `/sandbox?${next}`);
  }, [taskId, selected]);

  const nodes = useMemo(() => (tree ? buildTree(tree.entries) : []), [tree]);
  const counts = useMemo(() => countFiles(nodes), [nodes]);
  // Each task opens with its default folders; a refresh keeps what the user opened.
  useEffect(() => {
    if (!tree || expandedFor.current === tree.taskId) return;
    expandedFor.current = tree.taskId;
    setExpanded(defaultExpanded(nodes, counts.files, selected));
  }, [tree, nodes, counts.files, selected]);

  const pickTask = (id: string) => {
    if (id === taskId) return;
    setSelected(null);
    setTaskId(id);
  };
  const toggle = (path: string, open: boolean) =>
    setExpanded(current => {
      const next = new Set(current);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });

  const restore = async () => {
    if (!taskId || restoring) return;
    setRestoring(true);
    try {
      const result = await agentApi.restoreWorkspace(taskId);
      toast.success(`Workspace restored · ${result.restored} ${result.restored === 1 ? "file" : "files"}`);
      await loadTree(taskId, true);
    } catch (error) {
      toast.error("Couldn't restore the workspace", { description: errorMessage(error) });
    } finally {
      setRestoring(false);
    }
  };

  const current = tree && tree.taskId === taskId ? tree : null;
  const entry = current && selected ? current.entries.find(item => item.type === "file" && item.path === selected) : undefined;
  const actions: TopbarAction[] = taskId ? [{ id: "open", label: "Open task", icon: SquareTerminal, href: `/tasks/${taskId}`, priority: "secondary" }] : [];

  let body;
  if (tasks === null && tasksError) {
    body = (
      <div className="card">
        <StateNotice variant="error" title="Couldn't load your tasks" actions={<Button variant="primary" icon={RotateCcw} onClick={loadTasks}>Try again</Button>}>{tasksError}</StateNotice>
      </div>
    );
  } else if (tasks === null && !taskId) {
    body = <div className="card"><StateNotice variant="loading" title="Loading your tasks…" /></div>;
  } else if (tasks?.length === 0 && !taskId) {
    body = (
      <div className="card">
        <StateNotice variant="empty" icon={FolderOpen} title="No workspaces yet" actions={<Link href="/" className="btn primary"><Plus size={15} aria-hidden="true" /> New task</Link>}>
          Run a task in Agent mode: its files show up here while it works, and afterwards.
        </StateNotice>
      </div>
    );
  } else {
    body = (
      <section className="card sbx" aria-label="Workspace explorer">
        <div className="sbx-toolbar">
          <TaskPicker tasks={tasks ?? []} loading={tasks === null} value={taskId} onChange={pickTask} />
          {current && (
            <span className="chip" data-tone={current.source === "live" ? "info" : "neutral"}>
              {current.source === "live" ? <span className="dot" data-tone="success" aria-hidden="true" /> : <Archive size={13} aria-hidden="true" />}
              {current.source === "live" ? "Live workspace" : "Archived copy"}
            </span>
          )}
          <span className="spacer" />
          {counts.generated > 0 && (
            <button type="button" className="toggle" aria-pressed={hideGenerated} onClick={() => setHideGenerated(value => !value)}>
              <Layers size={14} aria-hidden="true" />
              <span className="toggle-label">Hide build output</span>
              <span className="badge">{counts.generated}</span>
            </button>
          )}
          <IconButton label="Refresh files" icon={RefreshCw} busy={treeLoading && Boolean(current)} disabled={!taskId} onClick={() => taskId && void loadTree(taskId, true)} />
        </div>
        {current?.source === "archived" && (
          <div className="notice sbx-archived" data-tone="neutral">
            <Archive size={16} aria-hidden="true" />
            <div className="notice-body">
              <p className="notice-title">Showing the archived copy</p>
              <p>This task's scratch workspace was archived after it went idle. You can read and download its files here. Restore the workspace to preview its site again; sending a follow-up restores it too.</p>
            </div>
            <div className="notice-actions">
              <Button size="sm" variant="primary" icon={ArchiveRestore} busy={restoring} onClick={() => void restore()}>{restoring ? "Restoring…" : "Restore workspace"}</Button>
            </div>
          </div>
        )}
        <div className="sbx-explorer">
          <div className="sbx-tree-pane">
            {!current ? (
              treeError ? (
                <StateNotice variant="error" size="sm" title="Couldn't load the files" actions={taskId ? <Button size="sm" icon={RotateCcw} onClick={() => void loadTree(taskId)}>Try again</Button> : undefined}>{treeError}</StateNotice>
              ) : taskId ? (
                <TreeSkeleton />
              ) : (
                <StateNotice variant="empty" size="sm" title="Pick a task">Choose a task above to browse its files.</StateNotice>
              )
            ) : nodes.length === 0 ? (
              <StateNotice variant="empty" size="sm" icon={FolderOpen} title="This workspace is empty">The agent hasn't written any files for this task.</StateNotice>
            ) : (
              <>
                {treeError && <p className="field-error sbx-tree-error" role="alert">{treeError}</p>}
                <FileTree nodes={nodes} expanded={expanded} hideGenerated={hideGenerated} selected={selected} onToggle={toggle} onSelect={setSelected} />
                {hideGenerated && counts.generated > 0 && <p className="sbx-tree-foot">{counts.generated} build {counts.generated === 1 ? "file" : "files"} hidden</p>}
              </>
            )}
          </div>
          <div className="sbx-viewer">
            {!taskId || !selected ? (
              <StateNotice variant="empty" icon={FileText} title="Pick a file">Choose a file in the tree to read it here.</StateNotice>
            ) : !current ? (
              <ViewerSkeleton />
            ) : !entry ? (
              <StateNotice variant="unavailable" title="This file isn't in the workspace" actions={<Button icon={RefreshCw} onClick={() => void loadTree(taskId, true)}>Refresh files</Button>}>
                <PathLabel path={selected} /> may have been moved or deleted since the list was loaded.
              </StateNotice>
            ) : (
              <FileViewer key={`${taskId}:${selected}`} taskId={taskId} path={selected} size={entry.size} onMissing={() => void loadTree(taskId, true)} />
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <AppShell title="Code Sandbox" topbarActions={actions}>
      <div className="page">
        <div className="page-wide">
          <header className="page-head">
            <div>
              <span className="eyebrow">Workspace files</span>
              <h2 className="page-title">Code Sandbox</h2>
              <p className="page-sub">Browse the files an agent task works on. While a task is active they live in its isolated scratch workspace; after an hour idle the workspace is archived, and it comes back when you send a follow-up.</p>
            </div>
          </header>
          {body}
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Task picker: a searchable popover instead of a native select with sliced prompts
// ---------------------------------------------------------------------------------------------

function TaskPicker({ tasks, loading = false, value, onChange }: { tasks: AgentTaskSummary[]; loading?: boolean; value: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const current = tasks.find(task => task.id === value);
  const label = current ? firstLine(current.prompt) ?? "Untitled task" : value ? `Task ${value.slice(0, 8)}` : "Choose a task";
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter(task => !needle || task.prompt.toLowerCase().includes(needle) || task.id.startsWith(needle)).map(task => ({ key: task.id, task }));
  }, [tasks, query]);
  return (
    <Popover.Root open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }}>
      <Popover.Trigger asChild>
        <button type="button" className="pick-trigger sbx-picker" title={current?.prompt}>
          <span className="sr-only">Task: </span>
          <span className="pick-label">{label}</span>
          <ChevronDown size={14} className="pick-chevron" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover combo-popover sbx-picker-popover"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={POPOVER_COLLISION}
          aria-label="Choose a task"
          onOpenAutoFocus={event => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="combo-head"><span className="micro">{loading ? "Agent tasks" : `Agent tasks · ${tasks.length}`}</span></div>
          <Combobox
            items={items}
            query={query}
            onQueryChange={setQuery}
            onSelect={item => { onChange(item.key); setOpen(false); }}
            currentKey={value}
            inputRef={inputRef}
            inputLabel="Search tasks"
            listLabel="Agent tasks"
            placeholder="Search by prompt"
            status={loading ? <StateNotice variant="loading" size="sm" title="Loading tasks…" /> : items.length === 0 ? <p className="combo-empty">{tasks.length ? `No tasks match “${query.trim()}”.` : "No agent tasks yet."}</p> : null}
            renderItem={({ task }) => (
              <>
                <span className="combo-title"><span className="truncate" title={task.prompt}>{firstLine(task.prompt) ?? "Untitled task"}</span></span>
                <span className="combo-meta">
                  <StatusBadge status={task.status} outcome={task.outcome} size="sm" />
                  <span>{relativeTime(task.createdAt)}</span>
                  {task.filesChanged > 0 && <span>{task.filesChanged} {task.filesChanged === 1 ? "file" : "files"} changed</span>}
                </span>
              </>
            )}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------------------------
// File tree (APG tree view: roving focus, arrows, Home/End, Enter/Space)
// ---------------------------------------------------------------------------------------------

function FileTree({ nodes, expanded, hideGenerated, selected, onToggle, onSelect }: {
  nodes: TreeNode[]; expanded: Set<string>; hideGenerated: boolean; selected: string | null; onToggle: (path: string, open: boolean) => void; onSelect: (path: string) => void;
}) {
  const flat = useMemo(() => flatten(nodes, expanded, hideGenerated), [nodes, expanded, hideGenerated]);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const indexOf = (path: string | null) => (path ? flat.findIndex(item => item.node.path === path) : -1);
  const tabStop = Math.max(0, indexOf(focusPath) >= 0 ? indexOf(focusPath) : indexOf(selected));

  const focusAt = (index: number) => {
    const item = flat[index];
    if (!item) return;
    setFocusPath(item.node.path);
    refs.current.get(item.node.path)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const { node, parent } = flat[index];
    const openable = node.type === "dir" && node.children.length > 0;
    const open = expanded.has(node.path);
    let handled = true;
    switch (event.key) {
      case "ArrowDown": focusAt(Math.min(flat.length - 1, index + 1)); break;
      case "ArrowUp": focusAt(Math.max(0, index - 1)); break;
      case "Home": focusAt(0); break;
      case "End": focusAt(flat.length - 1); break;
      case "ArrowRight":
        if (openable && !open) onToggle(node.path, true);
        else if (openable) focusAt(index + 1);
        break;
      case "ArrowLeft":
        if (openable && open) onToggle(node.path, false);
        else if (parent !== null) focusAt(indexOf(parent));
        break;
      case "Enter":
      case " ":
        if (node.type === "file") onSelect(node.path);
        else if (openable) onToggle(node.path, !open);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  return (
    <div className="sbx-tree" role="tree" aria-label="Files in this workspace">
      {flat.map((item, index) => {
        const { node } = item;
        const isDir = node.type === "dir";
        const openable = isDir && node.children.length > 0;
        const open = openable && expanded.has(node.path);
        const unlisted = isDir && node.children.length === 0 && UNLISTED.has(node.name);
        const Icon = isDir ? (open ? FolderOpen : Folder) : fileIcon(node.name);
        const meta = isDir
          ? unlisted ? "not listed" : node.generated ? `build output · ${node.fileCount}` : node.children.length === 0 ? "empty" : null
          : formatBytes(node.size);
        return (
          <div
            key={node.path}
            ref={element => {
              if (element) refs.current.set(node.path, element);
              else refs.current.delete(node.path);
            }}
            role="treeitem"
            aria-level={node.depth + 1}
            aria-setsize={item.setsize}
            aria-posinset={item.posinset}
            aria-expanded={openable ? open : undefined}
            aria-selected={isDir ? undefined : node.path === selected}
            tabIndex={index === tabStop ? 0 : -1}
            className="sbx-node"
            data-type={node.type}
            data-generated={node.generated || unlisted || undefined}
            style={{ "--depth": Math.min(node.depth, 8) } as CSSProperties}
            onFocus={() => setFocusPath(node.path)}
            onKeyDown={event => onKeyDown(event, index)}
            onClick={() => {
              if (!isDir) onSelect(node.path);
              else if (openable) onToggle(node.path, !open);
            }}
          >
            {openable ? <ChevronRight size={14} className="sbx-chevron" aria-hidden="true" /> : <span className="sbx-chevron-space" aria-hidden="true" />}
            <Icon size={15} className="sbx-icon" aria-hidden="true" />
            <span className="sbx-name" title={node.path}>{node.name}</span>
            {meta && <span className="sbx-meta">{meta}</span>}
          </div>
        );
      })}
    </div>
  );
}

function TreeSkeleton() {
  return (
    <div className="sbx-tree-skeleton">
      <p className="sr-only" role="status">Loading the files…</p>
      {Array.from({ length: 9 }, (_, index) => <span key={index} className="skeleton skeleton-text" aria-hidden="true" />)}
    </div>
  );
}

function ViewerSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="sbx-viewer-skeleton">
      <p className="sr-only" role="status">{label}</p>
      {Array.from({ length: 12 }, (_, index) => <span key={index} className="skeleton skeleton-text" aria-hidden="true" />)}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// File viewer
// ---------------------------------------------------------------------------------------------

type ViewState =
  | { status: "loading" }
  | { status: "image" }
  | { status: "text"; content: string; bytes: number; truncated: boolean }
  | { status: "binary"; bytes: number }
  | { status: "too-large"; message: string }
  | { status: "missing" }
  | { status: "error"; message: string };

function FileViewer({ taskId, path, size, onMissing }: { taskId: string; path: string; size: number; onMissing: () => void }) {
  const name = path.split("/").pop() || path;
  const image = IMAGE_FILE.test(path);
  const [state, setState] = useState<ViewState>(image ? { status: "image" } : { status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (image) return;
    let alive = true;
    setState({ status: "loading" });
    agentApi.file(taskId, path).then(
      data => {
        if (!alive) return;
        setState(data.binary ? { status: "binary", bytes: data.bytes } : { status: "text", content: data.content.replace(/\n$/, ""), bytes: data.bytes, truncated: Boolean(data.truncated) });
      },
      error => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 413) setState({ status: "too-large", message: error.message });
        else if (error instanceof ApiError && error.status === 404) setState({ status: "missing" });
        else setState({ status: "error", message: errorMessage(error, "Couldn't open this file.") });
      },
    );
    return () => {
      alive = false;
    };
  }, [taskId, path, image, attempt]);

  const content = state.status === "text" ? state.content : null;
  const lines = useMemo(() => (content === null ? [] : content.split("\n")), [content]);
  const shown = useMemo(() => (showAll ? lines : lines.slice(0, LINE_LIMIT)), [lines, showAll]);
  const language = languageForPath(path);
  const html = useMemo(() => shown.map(line => (line ? highlight(line, language) : " ")), [shown, language]);

  const rawUrl = agentApi.rawFileUrl(taskId, path);
  const download = (
    <a className="btn sm" href={agentApi.downloadUrl(taskId, path)} download={name}>
      <Download size={14} aria-hidden="true" /> Download
    </a>
  );
  const bytes = state.status === "text" || state.status === "binary" ? state.bytes : size;

  let body;
  if (state.status === "loading") body = <ViewerSkeleton label={`Loading ${name}…`} />;
  else if (state.status === "image") {
    body = (
      <div className="sbx-image grid-paper">
        <div className="sbx-image-frame"><MediaImage src={rawUrl} alt={name} variant="full" /></div>
      </div>
    );
  } else if (state.status === "binary") {
    body = <StateNotice variant="empty" icon={FileIcon} title="Binary file" actions={download}>{formatBytes(state.bytes)} of binary data can't be shown as text. Download it to open it with the right app.</StateNotice>;
  } else if (state.status === "too-large") {
    body = <StateNotice variant="unavailable" title="Too large to preview" actions={download}>{state.message} Download it to read it on your computer.</StateNotice>;
  } else if (state.status === "missing") {
    body = <StateNotice variant="unavailable" title="This file isn't in the workspace any more" actions={<Button icon={RefreshCw} onClick={onMissing}>Refresh files</Button>}>It may have been moved or deleted since the list was loaded.</StateNotice>;
  } else if (state.status === "error") {
    body = <StateNotice variant="error" title="Couldn't open this file" actions={<Button icon={RotateCcw} onClick={() => setAttempt(value => value + 1)}>Try again</Button>}>{state.message}</StateNotice>;
  } else if (state.content === "") {
    body = <StateNotice variant="empty" size="sm" icon={FileText} title="This file is empty" />;
  } else {
    body = (
      <>
        {(state.truncated || lines.length > shown.length) && (
          <div className="notice sbx-limit" data-tone="neutral">
            <FileText size={16} aria-hidden="true" />
            <div className="notice-body">
              {state.truncated
                ? `Showing the first 2 MB of ${formatBytes(state.bytes)}${lines.length > shown.length ? `, lines 1–${shown.length.toLocaleString()}` : ""}. Download the file to see all of it.`
                : `Showing lines 1–${shown.length.toLocaleString()} of ${lines.length.toLocaleString()}.`}
            </div>
            {lines.length > shown.length && <div className="notice-actions"><Button size="sm" onClick={() => setShowAll(true)}>Show all lines</Button></div>}
          </div>
        )}
        <div className="code-view sbx-code" tabIndex={0} role="region" aria-label={`Contents of ${name}`}>
          <table role="presentation">
            <tbody>
              {html.map((line, index) => (
                <tr key={index}>
                  <td className="ln" aria-hidden="true">{index + 1}</td>
                  <td dangerouslySetInnerHTML={{ __html: line }} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="sbx-file" aria-busy={state.status === "loading" || undefined}>
      <div className="sbx-viewer-head">
        <PathLabel path={path} className="sbx-path" />
        <span className="chip mono">{formatBytes(bytes)}</span>
        {image && (
          <a className="btn ghost sm" href={rawUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} aria-hidden="true" /> Full size<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {download}
      </div>
      <div className="sbx-file-body">{body}</div>
    </div>
  );
}
