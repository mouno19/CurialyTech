import { memo, useId, useMemo, useState } from "react";
import { diffLines } from "diff";
import { Check, ChevronDown, Columns2, Copy, Download, FileMinus, FilePlus, FileText, Rows2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/common/IconButton";
import { PathLabel } from "@/components/common/PathLabel";
import { Tip } from "@/components/common/Tooltip";
import type { FileChange } from "@/lib/taskStream";
import { formatBytes } from "@/lib/api";
import { highlight, languageForPath } from "@/lib/highlight";

type Row = { type: "ctx" | "add" | "del"; oldNo?: number; newNo?: number; text: string };
type Block = { kind: "rows"; rows: Row[] } | { kind: "gap"; rows: Row[] };

const CONTEXT = 3;

function buildRows(before: string, after: string): Row[] {
  const rows: Row[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const part of diffLines(before, after)) {
    if (part.value === "") continue;
    for (const text of part.value.replace(/\n$/, "").split("\n")) {
      if (part.added) rows.push({ type: "add", newNo: newNo++, text });
      else if (part.removed) rows.push({ type: "del", oldNo: oldNo++, text });
      else rows.push({ type: "ctx", oldNo: oldNo++, newNo: newNo++, text });
    }
  }
  return rows;
}

/** Collapse long unchanged stretches, keeping CONTEXT lines around each change. */
function blocks(rows: Row[]): Block[] {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.type === "ctx") return;
    for (let i = Math.max(0, index - CONTEXT); i <= Math.min(rows.length - 1, index + CONTEXT); i++) keep[i] = true;
  });
  const out: Block[] = [];
  let index = 0;
  while (index < rows.length) {
    const visible = keep[index];
    const start = index;
    while (index < rows.length && keep[index] === visible) index++;
    const slice = rows.slice(start, index);
    out.push(visible || slice.length <= 2 ? { kind: "rows", rows: slice } : { kind: "gap", rows: slice });
  }
  return out;
}

function splitPairs(rows: Row[]) {
  const pairs: { left?: Row; right?: Row }[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type === "ctx") {
      pairs.push({ left: rows[i], right: rows[i] });
      i++;
      continue;
    }
    const dels: Row[] = [];
    const adds: Row[] = [];
    while (i < rows.length && rows[i].type === "del") dels.push(rows[i++]);
    while (i < rows.length && rows[i].type === "add") adds.push(rows[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) pairs.push({ left: dels[k], right: adds[k] });
  }
  return pairs;
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name.split("/").pop() || "file.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const KIND_LABEL = { create: "Created", modify: "Modified", delete: "Deleted" } as const;
const KIND_TONE = { create: "success", modify: "neutral", delete: "danger" } as const;

export const DiffViewer = memo(function DiffViewer({ change, defaultMode = "unified", defaultOpen = true }: { change: FileChange; defaultMode?: "unified" | "split"; defaultOpen?: boolean }) {
  const [mode, setMode] = useState(defaultMode);
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const bodyId = useId();
  const rows = useMemo(() => (open ? buildRows(change.before, change.after) : []), [open, change.before, change.after]);
  const grouped = useMemo(() => blocks(rows), [rows]);
  const delta = change.bytesAfter - change.bytesBefore;
  const Icon = change.kind === "create" ? FilePlus : change.kind === "delete" ? FileMinus : FileText;
  const language = languageForPath(change.path);
  // Lines are highlighted one at a time; multi-line constructs may lose colour but never break layout.
  const code = (text: string | undefined) => ({ __html: text ? highlight(text, language) : " " });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(change.after);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy: the browser blocked clipboard access.");
    }
  };

  const renderUnified = (row: Row, key: string) => (
    <tr key={key} className={row.type}>
      <td className="ln" aria-hidden="true">{row.oldNo ?? ""}</td>
      <td className="ln" aria-hidden="true">{row.newNo ?? ""}</td>
      <td className="sign">{row.type === "add" ? <><span aria-hidden="true">+</span><span className="sr-only">added</span></> : row.type === "del" ? <><span aria-hidden="true">−</span><span className="sr-only">removed</span></> : null}</td>
      <td className="code" dangerouslySetInnerHTML={code(row.text)} />
    </tr>
  );

  const renderSplit = (pair: { left?: Row; right?: Row }, key: string) => (
    <tr key={key}>
      <td className="ln" aria-hidden="true">{pair.left?.oldNo ?? ""}</td>
      <td className={`code ${pair.left ? (pair.left.type === "del" ? "del" : "") : "empty-side"}`} dangerouslySetInnerHTML={code(pair.left?.text)} />
      <td className="ln" aria-hidden="true">{pair.right?.newNo ?? ""}</td>
      <td className={`code ${pair.right ? (pair.right.type === "add" ? "add" : "") : "empty-side"}`} dangerouslySetInnerHTML={code(pair.right?.text)} />
    </tr>
  );

  return (
    <section className="diff panel-ink" aria-label={`${KIND_LABEL[change.kind]} ${change.path}`}>
      <div className="diff-head">
        <button type="button" className="diff-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}>
          <ChevronDown size={14} className="diff-chevron" aria-hidden="true" />
          <Icon size={15} aria-hidden="true" />
          <PathLabel path={change.path} className="diff-path" />
        </button>
        <span className="chip" data-tone={KIND_TONE[change.kind]}>{KIND_LABEL[change.kind]}</span>
        <span className="diff-stat" aria-label={`${change.added} lines added, ${change.removed} removed`}>
          <span className="a" aria-hidden="true">+{change.added}</span> <span className="r" aria-hidden="true">−{change.removed}</span>
        </span>
        <span className="diff-bytes" title={`${formatBytes(change.bytesBefore)} → ${formatBytes(change.bytesAfter)}`}>
          {delta >= 0 ? "+" : "−"}{formatBytes(Math.abs(delta))}
        </span>
        <span className="spacer" />
        {open && (
          <div className="segmented" data-size="sm" role="group" aria-label="Diff layout">
            <Tip content="Unified">
              <button type="button" aria-pressed={mode === "unified"} aria-label="Unified" onClick={() => setMode("unified")}><Rows2 size={13} aria-hidden="true" /></button>
            </Tip>
            <Tip content="Side by side">
              <button type="button" aria-pressed={mode === "split"} aria-label="Side by side" onClick={() => setMode("split")}><Columns2 size={13} aria-hidden="true" /></button>
            </Tip>
          </div>
        )}
        {change.kind !== "delete" && (
          <>
            <IconButton size="sm" label={copied ? "Copied" : "Copy file contents"} icon={copied ? Check : Copy} onClick={() => void copy()} />
            <IconButton size="sm" label={`Download ${change.path.split("/").pop() ?? "file"}`} icon={Download} onClick={() => download(change.path, change.after)} />
          </>
        )}
      </div>
      <div id={bodyId} hidden={!open}>
        {open && change.truncated && (
          <p className="notice diff-notice" data-tone="warning">
            <TriangleAlert size={14} aria-hidden="true" />
            <span className="notice-body">Large file: the diff shows the first 256 KB of each side.</span>
          </p>
        )}
        {open && (
          <div className="diff-scroll">
            <table className="diff-table" data-mode={mode}>
              {mode === "split" ? <colgroup><col className="ln-col" /><col /><col className="ln-col" /><col /></colgroup> : <colgroup><col className="ln-col" /><col className="ln-col" /><col className="sign-col" /><col /></colgroup>}
              <tbody>
                {grouped.map((block, index) => {
                  if (block.kind === "gap" && !expanded.has(index)) {
                    return (
                      <tr key={`g${index}`} className="diff-gap">
                        <td colSpan={4}>
                          <button type="button" className="diff-gap-btn" onClick={() => setExpanded(current => new Set(current).add(index))}>
                            Show {block.rows.length} unchanged lines
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  return mode === "unified"
                    ? block.rows.map((row, rowIndex) => renderUnified(row, `${index}-${rowIndex}`))
                    : splitPairs(block.rows).map((pair, rowIndex) => renderSplit(pair, `${index}-${rowIndex}`));
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
});
