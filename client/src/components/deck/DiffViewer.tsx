import { useMemo, useState } from "react";
import { diffLines } from "diff";
import { Check, Columns2, Copy, Download, FileMinus, FilePlus, FileText, Rows2 } from "lucide-react";
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
    const lines = part.value.replace(/\n$/, "").split("\n");
    if (part.value === "") continue;
    for (const text of lines) {
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

export function DiffViewer({ change, defaultMode = "unified" }: { change: FileChange; defaultMode?: "unified" | "split" }) {
  const [mode, setMode] = useState(defaultMode);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => buildRows(change.before, change.after), [change.before, change.after]);
  const grouped = useMemo(() => blocks(rows), [rows]);
  const delta = change.bytesAfter - change.bytesBefore;
  const Icon = change.kind === "create" ? FilePlus : change.kind === "delete" ? FileMinus : FileText;
  const language = languageForPath(change.path);
  // Lines are highlighted one at a time; multi-line constructs may lose colour but never break layout.
  const code = (text: string | undefined) => ({ __html: text ? highlight(text, language) : " " });

  const copy = async () => {
    await navigator.clipboard.writeText(change.after);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const renderUnified = (row: Row, key: string) => (
    <tr key={key} className={row.type}>
      <td className="ln">{row.oldNo ?? ""}</td>
      <td className="ln">{row.newNo ?? ""}</td>
      <td className="sign">{row.type === "add" ? "+" : row.type === "del" ? "−" : " "}</td>
      <td className="code" dangerouslySetInnerHTML={code(row.text)} />
    </tr>
  );

  const renderSplit = (pair: { left?: Row; right?: Row }, key: string) => (
    <tr key={key}>
      <td className="ln">{pair.left?.oldNo ?? ""}</td>
      <td className={`code ${pair.left ? (pair.left.type === "del" ? "del" : "") : "empty-side"}`} dangerouslySetInnerHTML={code(pair.left?.text)} />
      <td className="ln">{pair.right?.newNo ?? ""}</td>
      <td className={`code ${pair.right ? (pair.right.type === "add" ? "add" : "") : "empty-side"}`} dangerouslySetInnerHTML={code(pair.right?.text)} />
    </tr>
  );

  return (
    <div className="diff">
      <div className="diff-head">
        <Icon size={15} className="faint" />
        <span className="diff-path" title={change.path}>{change.path}</span>
        <span className={`chip ${change.kind === "create" ? "mint" : change.kind === "delete" ? "red" : "violet"}`}>{change.kind}</span>
        <span className="diff-stat"><span className="a">+{change.added}</span> <span className="r">−{change.removed}</span></span>
        <span className="chip mono" title={`${change.bytesBefore} → ${change.bytesAfter} bytes`}>{delta >= 0 ? "+" : "−"}{formatBytes(Math.abs(delta))}</span>
        <span className="spacer" />
        <div className="segmented">
          <button type="button" className={mode === "unified" ? "on" : ""} onClick={() => setMode("unified")} title="Unified"><Rows2 size={12} /></button>
          <button type="button" className={mode === "split" ? "on" : ""} onClick={() => setMode("split")} title="Side by side"><Columns2 size={12} /></button>
        </div>
        {change.kind !== "delete" && (
          <>
            <button type="button" className="icon-btn sm" onClick={() => void copy()} title="Copy file contents">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
            <button type="button" className="icon-btn sm" onClick={() => download(change.path, change.after)} title="Download file"><Download size={14} /></button>
          </>
        )}
      </div>
      {change.truncated && <div className="alert warn" style={{ borderRadius: 0 }}>Large file: the diff shows the first 256 KB of each side.</div>}
      <div className="diff-scroll">
        <table className="diff-table">
          {mode === "split" && <colgroup><col style={{ width: 46 }} /><col /><col style={{ width: 46 }} /><col /></colgroup>}
          <tbody>
            {grouped.map((block, index) => {
              if (block.kind === "gap" && !expanded.has(index)) {
                return (
                  <tr key={`g${index}`} className="diff-gap" onClick={() => setExpanded(current => new Set(current).add(index))}>
                    <td colSpan={4}>⋯ {block.rows.length} unchanged lines (click to expand)</td>
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
    </div>
  );
}
