import { ArrowDown } from "lucide-react";
import { capCount } from "./format";

/**
 * The pill shown over a log the reader scrolled away from. It lives in a position:relative
 * frame around the scroller (not inside it), so it never changes the scroll height.
 */
export function JumpToLatest({ show, unseen = 0, onJump, size = "md", label = "Jump to latest" }: { show: boolean; unseen?: number; onJump: () => void; size?: "sm" | "md"; label?: string }) {
  if (!show) return null;
  return (
    <div className="jump-anchor" data-size={size}>
      <button type="button" className="jump-pill" onClick={onJump}>
        <ArrowDown size={size === "sm" ? 13 : 14} aria-hidden="true" />
        <span>
          {label}
          {unseen > 0 && <span className="jump-count"> · {capCount(unseen)} new</span>}
        </span>
      </button>
    </div>
  );
}
