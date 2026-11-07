import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Lock, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/common/Button";
import { cx } from "@/components/common/cx";
import { GitHubMark } from "@/components/common/GitHubMark";
import { IconButton } from "@/components/common/IconButton";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { useGitHub } from "@/lib/appStatus";
import { agentApi, errorMessage, relativeTime, type GitHubRepo } from "@/lib/api";

/** Popovers never slide under the topbar (56px + a little air) or past the screen edges. */
export const POPOVER_COLLISION = { top: 64, right: 12, bottom: 12, left: 12 };

// ---------------------------------------------------------------------------------------------
// Combobox: a filter input driving a listbox (APG combobox with list autocomplete). Focus stays in
// the input; arrows move the highlighted option (aria-activedescendant), Enter picks it and Esc is
// left to the surrounding popover. Shared by the repository and task pickers.
// ---------------------------------------------------------------------------------------------

export type ComboItem = { key: string; disabled?: boolean };

export type ComboboxProps<T extends ComboItem> = {
  /** Already filtered by `query`. */
  items: T[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (item: T) => void;
  /** The current value: marked with a check, and where the highlight starts. */
  currentKey?: string | null;
  renderItem: (item: T) => ReactNode;
  inputLabel: string;
  listLabel: string;
  placeholder?: string;
  /** Loading, error and empty states, shown under the input. */
  status?: ReactNode;
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function Combobox<T extends ComboItem>({ items, query, onQueryChange, onSelect, currentKey, renderItem, inputLabel, listLabel, placeholder, status, inputRef }: ComboboxProps<T>) {
  const id = useId();
  const listId = `${id}-list`;
  const listRef = useRef<HTMLUListElement>(null);
  const firstEnabled = () => items.findIndex(item => !item.disabled);
  const startIndex = () => {
    const current = query ? -1 : items.findIndex(item => item.key === currentKey && !item.disabled);
    return current >= 0 ? current : firstEnabled();
  };
  const [active, setActive] = useState(startIndex);
  const signature = items.map(item => item.key).join("\n");
  // A new result list (typing, data arriving): highlight the current value, or the first match.
  useEffect(() => setActive(startIndex()), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the highlighted option visible by moving the list's own scroll (never scrollIntoView).
  useLayoutEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [active, signature]);

  const step = (delta: number) => {
    if (!items.length) return;
    let next = active;
    for (let tries = 0; tries < items.length; tries++) {
      next = (next + delta + items.length) % items.length;
      if (!items[next].disabled) return setActive(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      step(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const target = Math.max(0, Math.min(items.length - 1, active + (event.key === "PageDown" ? 6 : -6)));
      if (items[target] && !items[target].disabled) setActive(target);
    } else if (event.key === "Enter") {
      const item = items[active];
      if (item && !item.disabled) {
        event.preventDefault();
        onSelect(item);
      }
    }
  };

  const activeItem = active >= 0 ? items[active] : undefined;
  return (
    <div className="combo">
      <div className="input-wrap combo-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeItem ? `${id}-${active}` : undefined}
          aria-label={inputLabel}
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && <IconButton className="input-end" size="sm" label="Clear search" icon={X} tooltip={false} onClick={() => { onQueryChange(""); inputRef?.current?.focus(); }} />}
      </div>
      <p className="sr-only" role="status">{query ? (items.length ? `${items.length} ${items.length === 1 ? "match" : "matches"}` : "No matches") : ""}</p>
      {status}
      <ul ref={listRef} id={listId} role="listbox" aria-label={listLabel} className="combo-list" hidden={!items.length}>
        {items.map((item, index) => {
          const current = item.key === currentKey;
          return (
            <li
              key={item.key}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              aria-disabled={item.disabled || undefined}
              data-index={index}
              data-active={index === active || undefined}
              data-current={current || undefined}
              className="combo-option"
              onPointerMove={() => { if (index !== active && !item.disabled) setActive(index); }}
              // Keep focus in the input (and the popover open) while clicking an option.
              onPointerDown={event => event.preventDefault()}
              onClick={() => { if (!item.disabled) onSelect(item); }}
            >
              <span className="combo-option-body">{renderItem(item)}</span>
              {current && (
                <span className="combo-check">
                  <Check size={15} aria-hidden="true" />
                  <span className="sr-only">(current)</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Repository picker: Popover + Combobox over the connected account's repositories
// ---------------------------------------------------------------------------------------------

let cache: { at: number; login: string; repos: GitHubRepo[] } | null = null;
const CACHE_MS = 60_000;

export type RepoSelectorProps = {
  value: string | null;
  onChange: (repo: GitHubRepo | null) => void;
  disabled?: boolean;
  /** Short trigger label ("Repo") for tight bars. */
  compact?: boolean;
  /** Which edge of the trigger the popover lines up with; it still flips and shifts to stay on screen. */
  align?: "start" | "end";
  /** Deprecated and ignored: the popover picks its side to stay on screen. */
  openDown?: boolean;
  className?: string;
  /** Offer the clear button next to a chosen repository (false: the value is the task's own, which can't be cleared here). */
  clearable?: boolean;
};

/** Repository picker: the trigger opens a searchable list; the clear button sits next to it, never inside. */
export function RepoSelector({ value, onChange, disabled = false, compact = false, align = "start", className, clearable = true }: RepoSelectorProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = value ?? (compact ? "Repo" : "Repository");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <span className={cx("repo-picker", className)} data-selected={value ? "" : undefined}>
        <Popover.Trigger asChild>
          <button type="button" className="pick-trigger repo-trigger" disabled={disabled} aria-label={value ? `Repository: ${value}` : "Choose a repository"} title={value ?? undefined}>
            <GitHubMark size={14} />
            <span className="pick-label">{label}</span>
            <ChevronDown size={14} className="pick-chevron" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        {value && !disabled && clearable && <IconButton className="repo-clear" size="sm" label={`Clear repository ${value}`} tooltip="Clear repository" icon={X} onClick={() => onChange(null)} />}
      </span>
      <Popover.Portal>
        <Popover.Content
          className="popover combo-popover repo-popover"
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={POPOVER_COLLISION}
          aria-label="Choose a repository"
          onOpenAutoFocus={event => {
            // Straight into the search field when there is one; otherwise Radix focuses the first control.
            if (!inputRef.current) return;
            event.preventDefault();
            inputRef.current.focus();
          }}
        >
          <RepoPanel value={value} inputRef={inputRef} onPick={repo => { onChange(repo); setOpen(false); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RepoPanel({ value, inputRef, onPick }: { value: string | null; inputRef: RefObject<HTMLInputElement | null>; onPick: (repo: GitHubRepo) => void }) {
  const github = useGitHub();
  const connected = Boolean(github.status?.connected);
  const [repos, setRepos] = useState<GitHubRepo[] | null>(cache?.repos ?? null);
  const [login, setLogin] = useState<string | null>(cache?.login ?? github.status?.login ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentApi.githubRepos();
      cache = { at: Date.now(), login: data.login, repos: data.repos };
      if (!alive.current) return;
      setRepos(data.repos);
      setLogin(data.login);
    } catch (loadError) {
      if (alive.current) setError(errorMessage(loadError, "Couldn't load your repositories."));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  // Cached lists show at once; a stale one refreshes in the background.
  useEffect(() => {
    if (connected && !(cache && Date.now() - cache.at < CACHE_MS)) void load();
  }, [connected, load]);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (repos ?? [])
      .filter(repo => !needle || repo.full_name.toLowerCase().includes(needle) || (repo.description ?? "").toLowerCase().includes(needle))
      .map(repo => ({ key: repo.full_name, repo }));
  }, [repos, query]);

  if (!github.status) {
    if (github.loading || !github.error) return <StateNotice variant="loading" size="sm" title="Checking GitHub…" />;
    return (
      <StateNotice variant="error" size="sm" title="Couldn't check GitHub" actions={<Button size="sm" icon={RotateCcw} busy={github.loading} onClick={() => void github.refresh()}>Try again</Button>}>
        {github.error}
      </StateNotice>
    );
  }
  if (!github.status.configured) {
    return (
      <StateNotice variant="unavailable" size="sm" title="GitHub isn't set up">
        An operator needs to configure the GitHub app on this server before repositories can be used.
      </StateNotice>
    );
  }
  if (!connected) {
    return (
      <StateNotice variant="info" size="sm" icon={null} title="Connect GitHub to work on a repository" actions={<a className="btn primary sm" href="/api/auth/github/start"><GitHubMark size={14} /> Connect GitHub</a>}>
        The agent clones the repository you pick into its workspace before it starts.
      </StateNotice>
    );
  }

  const status = error ? (
    <StateNotice variant="error" size="sm" title="Couldn't load repositories" actions={<Button size="sm" icon={RotateCcw} busy={loading} onClick={() => void load()}>Try again</Button>}>
      {error}
    </StateNotice>
  ) : repos === null ? (
    <StateNotice variant="loading" size="sm" title="Loading repositories…" />
  ) : repos.length === 0 ? (
    <StateNotice variant="empty" size="sm" title="No repositories yet">
      {login ? `${login} has no repositories this app can see.` : "This account has no repositories this app can see."}
    </StateNotice>
  ) : items.length === 0 ? (
    <p className="combo-empty">No repositories match “{query.trim()}”.</p>
  ) : null;

  return (
    <>
      <div className="combo-head">
        <span className="micro">{login ? `GitHub · ${login}` : "GitHub"}</span>
        {loading && repos && <span className="combo-refreshing"><Spinner size={12} /> Refreshing…</span>}
      </div>
      <Combobox
        items={items}
        query={query}
        onQueryChange={setQuery}
        onSelect={item => onPick(item.repo)}
        currentKey={value}
        inputRef={inputRef}
        inputLabel="Search repositories"
        listLabel="Repositories"
        placeholder="Search repositories"
        status={status}
        renderItem={({ repo }) => (
          <>
            <span className="combo-title">
              <span className="truncate" title={repo.full_name}>{repo.full_name}</span>
              {repo.private && (
                <>
                  <Lock size={12} className="combo-lock" aria-hidden="true" />
                  <span className="sr-only">, private</span>
                </>
              )}
            </span>
            {repo.description && <span className="combo-desc clamp-1" title={repo.description}>{repo.description}</span>}
            <span className="combo-meta">
              <span className="mono">{repo.default_branch}</span>
              {repo.language && <span>{repo.language}</span>}
              <span>updated {relativeTime(repo.updated_at)}</span>
            </span>
          </>
        )}
      />
    </>
  );
}
