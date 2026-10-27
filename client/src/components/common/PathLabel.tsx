import { cx } from "./cx";

/**
 * A file path whose directory part truncates first, so the file name always stays visible
 * ("src/compon…/Timeline.tsx"). The full path is the tooltip unless title={false}.
 */
export function PathLabel({ path, className, title = true }: { path: string; className?: string; title?: boolean | string }) {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  const dir = cut >= 0 ? trimmed.slice(0, cut + 1) : "";
  const name = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  return (
    <span className={cx("path-label", className)} title={title === true ? path : title || undefined}>
      {dir && <span className="path-dir">{dir}</span>}
      <span className="path-name">{name || path}</span>
    </span>
  );
}
