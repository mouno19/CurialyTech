import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Lock, Search, X } from "lucide-react";
import { GitHubMark } from "@/components/shell/AppShell";
import { agentApi, relativeTime, type GitHubRepo } from "@/lib/api";

let cache: { at: number; repos: GitHubRepo[]; login: string } | null = null;

/** Dropdown of the connected account's repositories with a search filter. */
export function RepoSelector({ value, onChange, disabled, openDown = false, compact = false }: { value: string | null; onChange: (repo: GitHubRepo | null) => void; disabled?: boolean; openDown?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[] | null>(cache?.repos ?? null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => search.current?.focus(), 0);
    if (cache && Date.now() - cache.at < 60_000) return;
    agentApi.githubRepos().then(data => { cache = { at: Date.now(), repos: data.repos, login: data.login }; setRepos(data.repos); setError(null); }).catch(loadError => setError(loadError.message));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return (repos ?? []).filter(repo => !query || repo.full_name.toLowerCase().includes(query) || (repo.description ?? "").toLowerCase().includes(query));
  }, [repos, filter]);

  return (
    <div className="model-picker" ref={ref}>
      <button type="button" className="model-trigger" disabled={disabled} onClick={() => setOpen(current => !current)} aria-haspopup="listbox" aria-expanded={open} title={value ? `Repository: ${value}` : "Select a GitHub repository"}>
        <GitHubMark size={13} />
        <span className="truncate">{value ?? (compact ? "Repo" : "Select Repository")}</span>
        {value && !disabled ? (
          <span role="button" tabIndex={0} aria-label="Clear repository" onClick={event => { event.stopPropagation(); onChange(null); }} onKeyDown={event => { if (event.key === "Enter") { event.stopPropagation(); onChange(null); } }}><X size={12} /></span>
        ) : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className={`model-menu repo-menu${openDown ? " down" : ""}`} role="listbox">
          <div className="repo-search">
            <Search size={13} className="faint" />
            <input ref={search} value={filter} placeholder="Filter repositories…" onChange={event => setFilter(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && visible[0]) { onChange(visible[0]); setOpen(false); } }} />
          </div>
          {error && <div className="alert error" style={{ margin: 6 }}>{error}</div>}
          {repos === null && !error && <div className="row faint" style={{ padding: 12, fontSize: 12 }}><Loader2 size={13} className="spin" /> Loading repositories…</div>}
          {repos && visible.length === 0 && <div className="faint" style={{ padding: 12, fontSize: 12 }}>No repositories match “{filter}”.</div>}
          {visible.map(repo => (
            <button key={repo.id} type="button" className={`model-option${value === repo.full_name ? " on" : ""}`} onClick={() => { onChange(repo); setOpen(false); }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong className="row" style={{ gap: 6 }}><span className="truncate">{repo.full_name}</span>{repo.private && <Lock size={11} className="faint" />}</strong>
                {repo.description && <small className="truncate" style={{ display: "block" }}>{repo.description}</small>}
                <span className="caps"><span>{repo.default_branch}</span>{repo.language && <span>{repo.language}</span>}<span>updated {relativeTime(repo.updated_at)}</span></span>
              </span>
              {value === repo.full_name && <Check size={14} style={{ flex: "0 0 auto" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
