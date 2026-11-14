import { useEffect, useId, useState, type CSSProperties } from "react";
import { ExternalLink, Radar, TriangleAlert } from "lucide-react";
import type { WebSource } from "@shared/agent";
import type { ItemOf } from "@/lib/taskStream";
import { monogram, SEARCH_LABELS, searchActive, searchAnnouncement, searchDuration, searchPhase, sourceDate, type SearchPhase } from "@/lib/webSearch";

// Web search in the chat: a live indicator while a search runs (the radar sweeps while the request
// is out, sources land on it as blips once results are back, it settles when the model moves on),
// and after the run its Sources, numbered as the answer cites them. Only real results are listed:
// a search that did not run says so and lists nothing.

/** Re-render every `ms` while `on` (the elapsed time and the searching → finding step). */
function useNow(on: boolean, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [on, ms]);
  return now;
}

/** Where blips land on the radar (percent of its size), one per source in order: contacts around the rings. */
const BLIPS = [
  [78, 31], [24, 35], [29, 75], [71, 68], [47, 14], [47, 80],
] as const;

function SearchOrb({ phase, count }: { phase: SearchPhase; count: number }) {
  const blips = phase === "reviewing" ? BLIPS.slice(0, Math.min(count, BLIPS.length)) : [];
  return (
    <span className="search-orb" data-phase={phase} aria-hidden="true">
      <span className="search-orb-grid" />
      <span className="search-orb-ping" />
      <span className="search-orb-ping" data-late="" />
      <span className="search-orb-sweep" />
      {blips.map(([x, y], index) => <span key={index} className="search-orb-blip" style={{ left: `${x}%`, top: `${y}%`, "--i": index } as CSSProperties} />)}
      <span className="search-orb-core">
        {phase === "found" && <svg viewBox="0 0 12 12" width="10" height="10"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        {phase === "unavailable" && <svg viewBox="0 0 12 12" width="10" height="10"><path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>}
        {(phase === "empty" || phase === "stopped") && <svg viewBox="0 0 12 12" width="10" height="10"><path d="M3 6h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>}
      </span>
    </span>
  );
}

function SourceBadge({ domain }: { domain: string }) {
  return <span className="source-mono" aria-hidden="true">{monogram(domain)}</span>;
}

/** The numbered list of sources: title (opens the page), site and date, one highlight. */
export function SourceList({ sources }: { sources: WebSource[] }) {
  return (
    <ol className="source-list">
      {sources.map(source => (
        <li key={source.url} className="source-item">
          <span className="source-n" aria-hidden="true">{source.n}</span>
          <div className="source-body">
            <a className="source-title" href={source.url} target="_blank" rel="noopener noreferrer">
              <span className="sr-only">Source {source.n}: </span>
              {source.title}
              <ExternalLink size={11} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <p className="source-meta">
              <SourceBadge domain={source.source} />
              <span className="truncate">{source.source}</span>
              {source.date && <><span aria-hidden="true">·</span><time dateTime={source.date}>{sourceDate(source.date)}</time></>}
            </p>
            {source.highlights[0] && <p className="source-snippet">{source.highlights[0]}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const CHIPS = 4;

/** One search while the run is live. */
export function SearchIndicator({ item, live }: { item: ItemOf<"search">; live: boolean }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const now = useNow(live && item.state === "searching");
  const elapsed = Math.max(0, now - Date.parse(item.ts));
  const phase = searchPhase(item.state, elapsed);
  const count = item.sources.length;
  const time = item.state === "searching" ? (live ? searchDuration(elapsed) : null) : item.durationMs !== undefined ? searchDuration(item.durationMs) : null;
  const meta = phase === "reviewing" || phase === "found" ? `${count} ${count === 1 ? "source" : "sources"}` : null;
  return (
    <div className="search-live" data-phase={phase} data-active={searchActive(phase) || undefined}>
      <SearchOrb phase={phase} count={count} />
      <div className="search-live-main">
        <p className="search-live-line">
          <span key={phase} className="search-live-label">{SEARCH_LABELS[phase]}</span>
          {meta && <span className="search-live-meta">{meta}</span>}
          {time && <span className="search-live-time" aria-hidden="true">{time}</span>}
        </p>
        <p className="search-live-query" title={item.query}><span className="sr-only">Search: </span>{item.query}</p>
        {phase === "unavailable" && item.reason && <p className="search-live-reason">{item.reason}.</p>}
        {count > 0 && (
          <div className="search-live-sources">
            <ul className="source-chips" aria-label={`Sources found (${count})`}>
              {item.sources.slice(0, CHIPS).map((source, index) => (
                <li key={source.url} style={{ "--i": index } as CSSProperties}>
                  <a className="source-chip" href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
                    <span className="source-chip-n" aria-hidden="true">{source.n}</span>
                    <span className="sr-only">Source {source.n}: </span>
                    <span className="truncate">{source.source}</span>
                    <span className="sr-only">, {source.title} (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
            <button type="button" className="source-more" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)}>
              {open ? "Hide list" : count > CHIPS ? `+${count - CHIPS} · view all` : "View all"}
            </button>
          </div>
        )}
        {open && count > 0 && <div id={listId} className="search-live-list"><SourceList sources={item.sources} /></div>}
      </div>
      <span className="sr-only" role="status" aria-live="polite">{searchAnnouncement(phase, count, item.reason)}</span>
    </div>
  );
}

/** A run's Sources, after it ended: what its searches found, or why they found nothing. */
export function SourcesSection({ sources, searches, docked }: { sources: WebSource[]; searches: ItemOf<"search">[]; docked?: boolean }) {
  if (!searches.length) return null;
  const failed = searches.filter(search => search.state === "unavailable");
  const queries = [...new Set(searches.map(search => search.query))];
  const quoted = queries.slice(0, 4).map(query => `“${query}”`).join(", ") + (queries.length > 4 ? ` and ${queries.length - 4} more` : "");
  const reasons = [...new Set(failed.map(search => search.reason).filter(Boolean))].join("; ");
  if (!sources.length) {
    return (
      <p className="sources-none" data-docked={docked || undefined} data-tone={failed.length ? "warning" : undefined}>
        {failed.length ? <TriangleAlert size={13} aria-hidden="true" /> : <Radar size={13} aria-hidden="true" />}
        <span>
          {failed.length ? `Web search was unavailable${reasons ? ` (${reasons.charAt(0).toLowerCase()}${reasons.slice(1)})` : ""}, so no web sources were used.` : `The web search found no relevant sources for ${quoted}.`}
        </span>
      </p>
    );
  }
  const domains = [...new Set(sources.map(source => source.source))];
  return (
    <details className="sources" data-docked={docked || undefined}>
      <summary>
        <Radar size={13} aria-hidden="true" />
        <span className="sources-title">Sources</span>
        <span className="sources-count">{sources.length}</span>
        <span className="sources-stack" aria-hidden="true">{domains.slice(0, 4).map(domain => <SourceBadge key={domain} domain={domain} />)}</span>
        <span className="sources-domains truncate">{domains.slice(0, 3).join(", ")}{domains.length > 3 ? ` +${domains.length - 3}` : ""}</span>
      </summary>
      <div className="sources-body">
        <SourceList sources={sources} />
        <p className="sources-queries">Searched the web for {quoted}.</p>
        {failed.length > 0 && (
          <p className="sources-warn">
            <TriangleAlert size={13} aria-hidden="true" />
            <span>{failed.length === 1 ? "One search" : `${failed.length} searches`} didn't run{reasons ? `: ${reasons.charAt(0).toLowerCase()}${reasons.slice(1)}` : ""}.</span>
          </p>
        )}
      </div>
    </details>
  );
}
