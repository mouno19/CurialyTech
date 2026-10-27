import { forwardRef, useEffect, useRef, useState, useSyncExternalStore, type AnchorHTMLAttributes, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CloudOff, ImageOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { agentApi } from "@/lib/api";
import { mediaHealth, useMediaHealth } from "@/lib/mediaHealth";
import { Button } from "@/components/common/Button";
import { cx } from "@/components/common/cx";
import { useCountdown } from "@/components/common/useCountdown";

// ---- One HEAD per file at a time; "gone" answers (404/410) are remembered for the session ----

type HeadEntry = { at: number; generation: number; promise: Promise<number>; value?: number };
const heads = new Map<string, HeadEntry>();
const HEAD_FRESH_MS = 10_000;

function headOnce(id: string): Promise<number> {
  const entry = heads.get(id);
  const generation = mediaHealth.get().generation;
  // Reuse a "gone" answer always; anything else only while fresh and from the same storage generation.
  if (entry && (entry.value === 404 || entry.value === 410 || (Date.now() - entry.at < HEAD_FRESH_MS && entry.generation === generation))) return entry.promise;
  const next: HeadEntry = { at: Date.now(), generation, promise: agentApi.mediaHead(id) };
  next.promise.then(status => (next.value = status));
  heads.set(id, next);
  if (heads.size > 500) heads.delete(heads.keys().next().value!);
  return next.promise;
}

const isGone = (status: number) => status === 404 || status === 410;
const RETRY_STEPS_S = [0, 5, 10, 20, 40, 60];

type Phase = "loading" | "loaded" | "checking" | "error" | "gone" | "broken";

export type MediaImageProps = {
  /** Stored file id (served by /api/agent/media/:id). Gated by the shared storage state. */
  id?: string | null;
  /** Any other source: a workspace file URL, a data: URL. Not gated by storage state. */
  src?: string;
  alt: string;
  mime?: string;
  /** thumb fills its (sized) parent and crops; full keeps the image's own shape. */
  variant?: "thumb" | "full";
  /** Intrinsic size when known: fixes the box's aspect ratio (no layout shift). */
  width?: number;
  height?: number;
  className?: string;
  loading?: "lazy" | "eager";
};

/**
 * An image with honest states: skeleton while loading, "No longer available" (404/410, no retry),
 * "Storage unavailable" (shared state and countdown, no request at all while it lasts), and
 * "Couldn't load" with a per-image Retry. Failures are explained with one deduped HEAD.
 */
export function MediaImage({ id, src, alt, mime, variant = "full", width, height, className, loading }: MediaImageProps) {
  const store = useMediaHealth();
  const stored = Boolean(id);
  const [phase, setPhase] = useState<Phase>("loading");
  const [bump, setBump] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const failedAt = useRef<number | null>(null); // store generation when this image last failed
  const token = useRef(0);
  const img = useRef<HTMLImageElement>(null);

  const base = id ? agentApi.mediaUrl(id) : src ?? null;
  const url = base && bump ? `${base}${base.includes("?") ? "&" : "?"}g=${bump}` : base;
  const notImage = Boolean(mime && !mime.startsWith("image/"));

  useEffect(() => {
    token.current += 1;
    failedAt.current = null;
    setPhase("loading");
    setBump(0);
    setAttempt(0);
    setRetryAt(null);
  }, [id, src]);

  // Storage came back: images that failed while it was down load again (with a fresh URL).
  useEffect(() => {
    if (failedAt.current === null || store.generation <= failedAt.current) return;
    failedAt.current = null;
    token.current += 1;
    setPhase("loading");
    setBump(value => value + 1);
  }, [store.generation]);

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    const element = img.current;
    if (element?.complete && element.naturalWidth > 0) setPhase("loaded");
  }, [url]);

  const onError = async () => {
    if (!stored || !id) {
      setPhase(base?.startsWith("data:") || base?.startsWith("blob:") ? "broken" : "error");
      return;
    }
    const mine = ++token.current;
    setPhase("checking");
    const health = await mediaHealth.reportFailure();
    if (mine !== token.current) return;
    if (health.status === "unavailable") {
      failedAt.current = health.generation;
      return setPhase("loading"); // the shared gate shows the storage tile
    }
    const status = await headOnce(id);
    if (mine !== token.current) return;
    if (isGone(status)) return setPhase("gone");
    failedAt.current = mediaHealth.get().generation;
    if (status === 503) return setPhase("loading"); // mediaHead marked storage unavailable
    setPhase("error");
    setRetryAt(Date.now() + RETRY_STEPS_S[Math.min(attempt, RETRY_STEPS_S.length - 1)] * 1000);
  };

  const retry = () => {
    if (id) heads.delete(id);
    token.current += 1;
    failedAt.current = null;
    setAttempt(value => value + 1);
    setRetryAt(null);
    setPhase("loading");
    setBump(value => value + 1);
  };

  const sized = Boolean(width && height);
  const style = sized ? ({ aspectRatio: `${width} / ${height}` } as CSSProperties) : undefined;
  const gated = stored && store.status === "unavailable" && phase !== "loaded";
  const shell = (content: ReactNode, shownPhase: string) => (
    <span className={cx("media-image", className)} data-variant={variant} data-phase={shownPhase} data-sized={sized || undefined} style={style}>
      {content}
    </span>
  );

  if (!base || notImage) return shell(<MediaTile variant={variant} icon={ImageOff} title="No preview" alt={alt} />, "empty");
  if (phase === "gone") return shell(<MediaTile variant={variant} icon={ImageOff} title="No longer available" detail="This file was removed from storage." alt={alt} />, "gone");
  if (gated) return shell(<StorageTile variant={variant} alt={alt} />, "unavailable");
  if (phase === "broken") return shell(<MediaTile variant={variant} icon={ImageOff} title="Can't display this image" detail="The file may be damaged or in a format the browser cannot show." alt={alt} />, "broken");
  if (phase === "error") return shell(<FailedTile variant={variant} alt={alt} retryAt={retryAt} onRetry={retry} />, "error");
  return shell(
    <>
      <img
        ref={img}
        key={url ?? undefined}
        src={url ?? undefined}
        alt={alt}
        width={width}
        height={height}
        loading={loading ?? (variant === "thumb" ? "lazy" : "eager")}
        decoding="async"
        onLoad={() => setPhase("loaded")}
        onError={() => void onError()}
      />
      {phase !== "loaded" && <span className="skeleton" aria-hidden="true" />}
    </>,
    phase,
  );
}

function MediaTile({ variant, icon: Icon, title, detail, alt, children }: { variant: "thumb" | "full"; icon: LucideIcon; title: string; detail?: ReactNode; alt: string; children?: ReactNode }) {
  if (variant === "thumb") {
    return (
      <span className="media-tile" role="img" aria-label={alt ? `${alt}: ${title}` : title} title={title}>
        <Icon size={18} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="media-tile">
      <Icon size={22} aria-hidden="true" />
      <span className="media-tile-title">{title}</span>
      {alt && <span className="sr-only">{alt}</span>}
      {detail && <span className="media-tile-detail">{detail}</span>}
      {children}
    </span>
  );
}

function StorageTile({ variant, alt }: { variant: "thumb" | "full"; alt: string }) {
  if (variant === "thumb") return <MediaTile variant="thumb" icon={CloudOff} title="Storage unavailable" alt={alt} />;
  return <StorageTileFull alt={alt} />;
}

function StorageTileFull({ alt }: { alt: string }) {
  const store = useMediaHealth();
  const left = useCountdown(store.retryAt);
  return (
    <MediaTile variant="full" icon={CloudOff} title="Storage unavailable" detail="Files can't be shown right now." alt={alt}>
      <Button size="sm" icon={RotateCcw} busy={store.probing} aria-disabled={left > 0 || undefined} onClick={() => void mediaHealth.retry()}>
        {store.probing ? "Checking…" : left > 0 ? `Retry in ${left} s` : "Retry"}
      </Button>
    </MediaTile>
  );
}

function FailedTile({ variant, alt, retryAt, onRetry }: { variant: "thumb" | "full"; alt: string; retryAt: number | null; onRetry: () => void }) {
  const left = useCountdown(variant === "full" ? retryAt : null);
  if (variant === "thumb") return <MediaTile variant="thumb" icon={ImageOff} title="Couldn't load" alt={alt} />;
  return (
    <MediaTile variant="full" icon={ImageOff} title="Couldn't load" detail="The image did not load." alt={alt}>
      <Button size="sm" icon={RotateCcw} aria-disabled={left > 0 || undefined} onClick={onRetry}>
        {left > 0 ? `Retry in ${left} s` : "Retry"}
      </Button>
    </MediaTile>
  );
}

// ---- Links to stored files: check first, explain failures in a toast instead of an error page ----

export type MediaLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "download" | "target"> & {
  id: string;
  filename?: string;
  /** Download (Content-Disposition: attachment) instead of opening in a new tab. */
  download?: boolean;
  children: ReactNode;
};

/** Download/open link for a stored file. HEADs first (no storage I/O) and shows a toast when the file can't be served. */
/** forwardRef so it can sit inside a tooltip or a Radix asChild slot. */
export const MediaLink = forwardRef<HTMLAnchorElement, MediaLinkProps>(function MediaLink({ id, filename, download = false, children, onClick, rel, ...rest }, ref) {
  const href = download ? agentApi.mediaDownloadUrl(id) : agentApi.mediaUrl(id);
  const name = filename || "This file";
  const handle = async (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    // Modified clicks (new tab, save as) keep the browser's own behaviour.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const status = await headOnce(id);
    if (status === 200) return download ? startDownload(href, filename) : openTab(href, name);
    if (isGone(status)) toast.error(`${name} is no longer available.`);
    else if (status === 503) toast.error("Files can't be opened right now.", { description: "File storage isn't responding. Try again in a moment." });
    else toast.error(`Couldn't open ${name}.`, { description: "Check your connection and try again." });
  };
  return (
    <a {...rest} ref={ref} href={href} download={download ? filename || "" : undefined} target={download ? undefined : "_blank"} rel={download ? rel : rel ?? "noopener noreferrer"} onClick={event => void handle(event)}>
      {children}
    </a>
  );
});

function startDownload(href: string, filename?: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename ?? "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function openTab(href: string, name: string) {
  const tab = window.open(href, "_blank");
  if (tab) {
    tab.opener = null;
    return;
  }
  // Popup blocked (the check took the click's activation): offer a fresh click.
  toast(`${name} is ready`, { action: { label: "Open", onClick: () => window.open(href, "_blank", "noopener,noreferrer") } });
}

// ---- Storage banner: one per page, neutral wording, the shared countdown ----

const slots: symbol[] = [];
const slotListeners = new Set<() => void>();
const notifySlots = () => slotListeners.forEach(listener => listener());
const subscribeSlots = (listener: () => void) => {
  slotListeners.add(listener);
  return () => void slotListeners.delete(listener);
};

/** Only the first mounted banner renders, however many screens place one. */
function useFirstSlot() {
  const [token] = useState(() => Symbol("storage-banner"));
  useEffect(() => {
    slots.push(token);
    notifySlots();
    return () => {
      slots.splice(slots.indexOf(token), 1);
      notifySlots();
    };
  }, [token]);
  return useSyncExternalStore(subscribeSlots, () => slots[0] === token, () => false);
}

/** "Files can't be shown right now · Retry (in 25 s)". Renders nothing while storage is fine. */
export function StorageBanner({ className }: { className?: string }) {
  const store = useMediaHealth();
  const first = useFirstSlot();
  const left = useCountdown(store.status === "unavailable" ? store.retryAt : null);
  if (!first || store.status !== "unavailable") return null;
  return (
    <div className={cx("notice storage-banner", className)} data-tone="neutral">
      <CloudOff size={16} aria-hidden="true" />
      <div className="notice-body">
        <p className="notice-title" role="status">Files can't be shown right now</p>
        <p>{store.detail || "File storage isn't responding. Previews and downloads come back when it does."}</p>
      </div>
      <div className="notice-actions">
        <Button size="sm" icon={RotateCcw} busy={store.probing} aria-disabled={left > 0 || undefined} onClick={() => void mediaHealth.retry()}>
          {store.probing ? "Checking…" : left > 0 ? `Retry (in ${left} s)` : "Retry"}
        </Button>
      </div>
    </div>
  );
}
