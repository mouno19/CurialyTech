import zlib from "node:zlib";

// Documents and tables are read here, in the app, so a task can summarize a PDF, a Word file or a
// spreadsheet without installing a parser or a data library in the sandbox. A scan (a PDF with no
// text layer) stays unreadable: nothing here invents words that are not in the file.

const MAX_ENTRY = 20 * 1024 * 1024;
const MAX_UNZIPPED = 40 * 1024 * 1024;
const MAX_PDF_BYTES = 16 * 1024 * 1024;
const MAX_TEXT = 200_000;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 40;
const NOTE_EXCERPT = 8_000;

export type FileReading = {
  kind: "document" | "table" | "text";
  /** Short label, e.g. "PDF, 3 pages" or "CSV table". */
  label: string;
  /** Extracted prose, already capped. Empty for a table. */
  text: string;
  /** The table summary. Empty for a document. */
  summary: string;
  /** Set when nothing usable could be read. */
  warning?: string;
};

type Grid = {
  title: string;
  headers: string[];
  rows: string[][];
  truncated: boolean;
  extraColumns: number;
};

/** What an attachment note should say. `used` is how much of the shared excerpt budget this file took. */
export function attachmentReading(
  relative: string,
  reading: FileReading,
  budget: number
): { block: string; used: number } {
  if (reading.warning && !reading.text && !reading.summary)
    return {
      block: `- ${relative}: ${reading.warning}`,
      used: reading.warning.length,
    };
  if (reading.kind === "table") {
    const body = clipText(reading.summary, Math.max(0, budget));
    const clipped =
      body.length < reading.summary.length
        ? "\n[Summary shortened to fit the message.]"
        : "";
    return {
      block: `- ${relative} (${reading.label})\n${body}${clipped}`,
      used: body.length,
    };
  }
  const allowance = Math.min(NOTE_EXCERPT, Math.max(0, budget));
  if (allowance === 0) {
    const where =
      reading.kind === "document" ? `${relative}.reading.txt` : relative;
    return {
      block: `- ${relative} (${reading.label}). Reading saved at ${where} (${reading.text.length.toLocaleString("en-US")} characters).`,
      used: 0,
    };
  }
  const excerpt = reading.text.slice(0, allowance);
  const more = excerpt.length < reading.text.length;
  const where = more
    ? ` First ${excerpt.length.toLocaleString("en-US")} characters of ${reading.text.length.toLocaleString("en-US")} follow.`
    : "";
  const sidecar =
    reading.kind === "document"
      ? ` Full reading: ${relative}.reading.txt.`
      : "";
  const rest =
    more && reading.kind === "document"
      ? ` read_document with start: ${excerpt.length} continues from there.`
      : "";
  return {
    block: `- ${relative} (${reading.label}).${where}${sidecar}${rest}\n${excerpt}`,
    used: excerpt.length,
  };
}

/** The next character offset a follow-up read_document call should pass. */
export function documentSlice(
  reading: FileReading,
  start: number,
  maxChars: number
): string {
  if (reading.warning && !reading.text) return reading.warning;
  const text = reading.kind === "table" ? reading.summary : reading.text;
  if (start >= text.length)
    return `${reading.label}. This reading is ${text.length.toLocaleString("en-US")} characters; start ${start} is past the end.`;
  const slice = text.slice(start, start + maxChars);
  const end = start + slice.length;
  const more =
    end < text.length
      ? `\n\nMore remains (${(text.length - end).toLocaleString("en-US")} characters). Call read_document again with start: ${end}.`
      : "";
  return `${reading.label}. Characters ${start + 1}-${end} of ${text.length.toLocaleString("en-US")}.\n\n${slice}${more}`;
}

export async function readFileContents(
  filename: string,
  mime: string,
  bytes: Buffer
): Promise<FileReading | null> {
  const kind = detectKind(filename, mime);
  if (kind === "skip") return null;
  if (kind === "doc")
    return {
      kind: "document",
      label: "Word document",
      text: "",
      summary: "",
      warning:
        "Legacy Word .doc files are not readable. Save the file as .docx and attach that.",
    };
  if (kind === "xls")
    return {
      kind: "table",
      label: "Excel spreadsheet",
      text: "",
      summary: "",
      warning:
        "Legacy Excel .xls files are not readable. Save the file as .xlsx or .csv and attach that.",
    };
  if (kind === "pdf") return readPdf(bytes);
  if (kind === "docx" || kind === "pptx") return readOffice(kind, bytes);
  if (kind === "xlsx") return readSheet(bytes);
  if (kind === "csv" || kind === "tsv")
    return readDelimited(filename, bytes, kind);
  if (kind === "json") return readJsonTable(filename, bytes);
  if (looksBinary(bytes)) return null;
  const text = clipText(decodeText(bytes), MAX_TEXT);
  if (!text.trim()) return null;
  return { kind: "text", label: "text file", text, summary: "" };
}

/** A table summary for analyze_data. `sheet` picks an Excel sheet by name. */
export async function analyzeFile(
  filename: string,
  mime: string,
  bytes: Buffer,
  sheet?: string
): Promise<string> {
  const kind = detectKind(filename, mime || filename);
  if (kind === "pdf" || kind === "docx" || kind === "pptx" || kind === "doc")
    return "This is a document, not a table. Use read_document to read it.";
  if (kind === "xls")
    return "Legacy Excel .xls files are not readable. Save the file as .xlsx or .csv.";
  if (kind === "xlsx") {
    const grids = xlsxGrids(bytes);
    if (typeof grids === "string") return grids;
    const wanted = sheet?.trim();
    const grid = wanted
      ? grids.find(item => item.title.toLowerCase() === wanted.toLowerCase())
      : grids[0];
    if (!grid)
      return `No sheet named "${wanted}". Sheets: ${grids.map(item => item.title).join(", ") || "(none)"}.`;
    return formatGrid(grid, wanted ? [] : grids.filter(item => item !== grid));
  }
  const reading = await readFileContents(filename, mime, bytes);
  if (!reading) return "This file is not a CSV, TSV, JSON or Excel table.";
  if (reading.warning && !reading.summary) return reading.warning;
  if (reading.kind !== "table")
    return "This file is not a CSV, TSV, JSON or Excel table.";
  return reading.summary;
}

// ---- Office packages (zip of XML) ----

function readOffice(kind: "docx" | "pptx", bytes: Buffer): FileReading {
  const files = unzip(bytes);
  if (!files)
    return {
      kind: "document",
      label: kind === "docx" ? "Word document" : "PowerPoint",
      text: "",
      summary: "",
      warning:
        "Could not open this file. It may be damaged or password-protected.",
    };
  const text = kind === "docx" ? docxText(files) : pptxText(files);
  const label = kind === "docx" ? "Word document" : "PowerPoint";
  if (!text.trim())
    return {
      kind: "document",
      label,
      text: "",
      summary: "",
      warning: `No readable text in this ${label}.`,
    };
  return {
    kind: "document",
    label,
    text: clipText(text, MAX_TEXT),
    summary: "",
  };
}

function docxText(files: Map<string, Buffer>) {
  const body = files.get("word/document.xml");
  if (!body) return "";
  const paragraphs = xmlParagraphs(body.toString("utf8"), "w:p", "w:t");
  const notes = files.get("word/footnotes.xml");
  const footnotes = notes
    ? xmlParagraphs(notes.toString("utf8"), "w:p", "w:t").filter(
        line => line.trim() && line.trim() !== " "
      )
    : [];
  return [
    paragraphs.join("\n"),
    footnotes.length ? `Footnotes\n${footnotes.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function pptxText(files: Map<string, Buffer>) {
  const slides = [...files.keys()]
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  return slides
    .map((name, index) => {
      const lines = [
        ...(files.get(name)?.toString("utf8") ?? "").matchAll(
          /<a:t[^>]*>([^<]*)<\/a:t>/g
        ),
      ].map(match => xmlDecode(match[1]));
      return `Slide ${index + 1}\n${lines
        .join(" ")
        .replace(/[ \t]{2,}/g, " ")
        .trim()}`;
    })
    .filter(slide => !/^Slide \d+\s*$/.test(slide))
    .join("\n\n");
}

function slideNumber(name: string) {
  return Number(/slide(\d+)\.xml/i.exec(name)?.[1] ?? 0);
}

/** Paragraph text, in order. A Word paragraph is one line; a break inside it stays a space. */
function xmlParagraphs(xml: string, paragraph: string, textTag: string) {
  const lines: string[] = [];
  for (const block of xml.split(new RegExp(`</${paragraph}>`, "i"))) {
    const bits = [
      ...block.matchAll(
        new RegExp(`<${textTag}[^>]*>([^<]*)</${textTag}>`, "gi")
      ),
    ].map(match => xmlDecode(match[1]));
    const line = bits
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    if (line) lines.push(line);
  }
  return lines;
}

function readSheet(bytes: Buffer): FileReading {
  const grids = xlsxGrids(bytes);
  if (typeof grids === "string")
    return {
      kind: "table",
      label: "Excel spreadsheet",
      text: "",
      summary: "",
      warning: grids,
    };
  if (!grids.length)
    return {
      kind: "table",
      label: "Excel spreadsheet",
      text: "",
      summary: "",
      warning: "This spreadsheet has no sheets.",
    };
  return {
    kind: "table",
    label: "Excel spreadsheet",
    text: "",
    summary: formatGrid(grids[0], grids.slice(1)),
  };
}

function xlsxGrids(bytes: Buffer): Grid[] | string {
  const files = unzip(bytes);
  if (!files)
    return "Could not open this spreadsheet. It may be damaged or password-protected.";
  const book = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const strings = sharedStrings(
    files.get("xl/sharedStrings.xml")?.toString("utf8") ?? ""
  );
  const sheets = [
    ...book.matchAll(
      /<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"|<sheet\b[^>]*\br:id="([^"]+)"[^>]*\bname="([^"]*)"/g
    ),
  ];
  const grids: Grid[] = [];
  for (const match of sheets.slice(0, 10)) {
    const name = xmlDecode(match[1] || match[4] || "Sheet");
    const id = match[2] || match[3];
    const target = targetOf(rels, id);
    const xml = target ? files.get(target)?.toString("utf8") : undefined;
    if (!xml) continue;
    grids.push(gridFromSheet(name, xml, strings));
  }
  if (!grids.length && files.has("xl/worksheets/sheet1.xml"))
    grids.push(
      gridFromSheet(
        "Sheet1",
        files.get("xl/worksheets/sheet1.xml")!.toString("utf8"),
        strings
      )
    );
  return grids;
}

function targetOf(rels: string, id: string) {
  const tags = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(
    match => match[0]
  );
  const tag = tags.find(item => item.includes(`Id="${id}"`));
  const target = tag ? /Target="([^"]+)"/.exec(tag)?.[1] : undefined;
  if (!target) return null;
  const relative = target.replace(/^\/?xl\//, "").replace(/^\//, "");
  return `xl/${relative}`;
}

function sharedStrings(xml: string) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map(match =>
    [...match[0].matchAll(/<t[^>]*>([^<]*)<\/t>/g)]
      .map(text => xmlDecode(text[1]))
      .join("")
  );
}

function gridFromSheet(title: string, xml: string, strings: string[]): Grid {
  const rows: string[][] = [];
  let extraColumns = 0;
  let truncated = false;
  for (const match of xml.matchAll(
    /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g
  )) {
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const inner = match[2] ?? "";
    const row: string[] = [];
    for (const cell of inner.matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    )) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cell[1])?.[1] ?? "";
      const index = ref ? columnIndex(ref) : row.length;
      if (index >= MAX_COLUMNS) {
        extraColumns = Math.max(extraColumns, index - MAX_COLUMNS + 1);
        continue;
      }
      while (row.length < index) row.push("");
      row[index] = cellValue(cell[1], cell[2] ?? "", strings);
    }
    if (row.some(value => value.trim())) rows.push(row);
  }
  return { title, ...withHeader(rows), truncated, extraColumns };
}

function cellValue(attrs: string, inner: string, strings: string[]) {
  const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
  if (type === "inlineStr")
    return [...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)]
      .map(match => xmlDecode(match[1]))
      .join("");
  const raw = xmlDecode(/<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? "");
  if (type === "s") return strings[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "true" : "false";
  return raw;
}

function columnIndex(letters: string) {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function unzip(buffer: Buffer): Map<string, Buffer> | null {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return null;
  const eocd = findEocd(buffer);
  if (eocd < 0) return null;
  const count = buffer.readUInt16LE(eocd + 8);
  const listed = buffer.readUInt16LE(eocd + 10);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || listed === 0xffff || offset === 0xffffffff)
    return null;
  const files = new Map<string, Buffer>();
  let cursor = offset;
  let total = 0;
  for (
    let index = 0;
    index < listed && index < 400 && cursor + 46 <= buffer.length;
    index++
  ) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compSize = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLen)
      .toString("utf8")
      .replace(/\\/g, "/");
    cursor += 46 + nameLen + extraLen + commentLen;
    if (
      name.endsWith("/") ||
      flags & 1 ||
      compSize > MAX_ENTRY ||
      local === 0xffffffff
    )
      continue;
    const data = inflateEntry(buffer, local, method, compSize);
    if (!data || total + data.length > MAX_UNZIPPED) continue;
    total += data.length;
    files.set(name, data);
  }
  return files;
}

function inflateEntry(
  buffer: Buffer,
  local: number,
  method: number,
  compSize: number
) {
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50)
    return null;
  const nameLen = buffer.readUInt16LE(local + 26);
  const extraLen = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLen + extraLen;
  if (start + compSize > buffer.length) return null;
  const compressed = buffer.subarray(start, start + compSize);
  if (method === 0) return Buffer.from(compressed);
  if (method !== 8) return null;
  try {
    return zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY });
  } catch {
    return null;
  }
}

function findEocd(buffer: Buffer) {
  const start = Math.max(0, buffer.length - 22 - 65535);
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function xmlDecode(value: string) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => safeCode(Number(digits)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function safeCode(code: number) {
  if (
    !Number.isFinite(code) ||
    code < 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff)
  )
    return "";
  return String.fromCodePoint(code);
}

// ---- PDF ----

async function readPdf(bytes: Buffer): Promise<FileReading> {
  if (bytes.length > MAX_PDF_BYTES)
    return {
      kind: "document",
      label: "PDF",
      text: "",
      summary: "",
      warning: "This PDF is over 16 MB, which is too large to read here.",
    };
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
    return {
      kind: "document",
      label: "PDF",
      text: "",
      summary: "",
      warning: "This file is not a PDF.",
    };
  try {
    const { extractText } = await import("unpdf");
    const { totalPages, text } = await extractText(new Uint8Array(bytes), {
      mergePages: true,
    });
    const cleaned = clipText(text.replace(/\u0000/g, "").trim(), MAX_TEXT);
    const label = `PDF, ${totalPages} page${totalPages === 1 ? "" : "s"}`;
    if (!cleaned)
      return {
        kind: "document",
        label,
        text: "",
        summary: "",
        warning:
          "No text layer in this PDF. It may be a scan, so the words are not readable.",
      };
    return { kind: "document", label, text: cleaned, summary: "" };
  } catch (error) {
    console.error(
      "[reading] pdf:",
      error instanceof Error ? error.message : error
    );
    return {
      kind: "document",
      label: "PDF",
      text: "",
      summary: "",
      warning:
        "Could not read this PDF. It may be password-protected or damaged.",
    };
  }
}

// ---- Tables ----

function readDelimited(
  filename: string,
  bytes: Buffer,
  kind: "csv" | "tsv"
): FileReading {
  const text = decodeText(bytes);
  if (!text.trim())
    return {
      kind: "table",
      label: kind.toUpperCase() + " table",
      text: "",
      summary: "",
      warning: "This file is empty.",
    };
  const parsed = parseDelimited(text, delimiterOf(text, kind));
  const grid = gridFromRows(filename, parsed.rows);
  grid.truncated = grid.truncated || parsed.truncated;
  return {
    kind: "table",
    label: `${kind.toUpperCase()} table`,
    text: "",
    summary: formatGrid(grid, []),
  };
}

function readJsonTable(filename: string, bytes: Buffer): FileReading {
  const text = decodeText(bytes);
  const grids = gridsFromJson(text);
  if (typeof grids === "string") {
    if (grids === "This file is empty.")
      return {
        kind: "text",
        label: "JSON",
        text: "",
        summary: "",
        warning: grids,
      };
    const excerpt = clipText(text.trim(), MAX_TEXT);
    if (!excerpt)
      return {
        kind: "text",
        label: "JSON",
        text: "",
        summary: "",
        warning: "This file is empty.",
      };
    return { kind: "text", label: "JSON", text: excerpt, summary: "" };
  }
  if (grids.length === 1) grids[0].title = filename;
  return {
    kind: "table",
    label: "JSON table",
    text: "",
    summary: formatGrid(grids[0], grids.slice(1)),
  };
}

function delimiterOf(text: string, kind: "csv" | "tsv") {
  if (kind === "tsv") return "\t";
  const sample = text.slice(0, 4000);
  const commas = sample.split(",").length;
  const tabs = sample.split("\t").length;
  return tabs > commas ? "\t" : ",";
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell);
      cell = "";
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      if (rows.length >= MAX_ROWS) {
        truncated = index < text.length - 1;
        break;
      }
    } else cell += char;
  }
  if (!truncated && (cell.length || row.length)) {
    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);
  }
  return { rows, truncated };
}

function gridsFromJson(text: string): Grid[] | string {
  const trimmed = text.trim();
  if (!trimmed) return "This file is empty.";
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    if (lines.length && lines.every(line => line.startsWith("{"))) {
      try {
        const objects = lines
          .slice(0, MAX_ROWS + 1)
          .map(line => JSON.parse(line) as unknown);
        if (
          objects.every(
            item => item && typeof item === "object" && !Array.isArray(item)
          )
        ) {
          return [
            objectsToGrid(
              "records",
              objects as Record<string, unknown>[],
              lines.length > MAX_ROWS
            ),
          ];
        }
      } catch {
        /* not JSON lines */
      }
    }
    return "not a table";
  }
  if (Array.isArray(parsed)) {
    const grid = arrayToGrid("records", parsed);
    return grid ? [grid] : "not a table";
  }
  if (parsed && typeof parsed === "object") {
    const arrays = Object.entries(parsed as Record<string, unknown>).filter(
      ([, value]) => Array.isArray(value)
    );
    const grids = arrays
      .map(([name, value]) => arrayToGrid(name, value as unknown[]))
      .filter((grid): grid is Grid => Boolean(grid));
    if (grids.length) return grids.slice(0, 10);
  }
  return "not a table";
}

function arrayToGrid(title: string, value: unknown[]): Grid | null {
  if (!value.length)
    return { title, headers: [], rows: [], truncated: false, extraColumns: 0 };
  if (
    value.every(
      item => item && typeof item === "object" && !Array.isArray(item)
    )
  )
    return objectsToGrid(
      title,
      value as Record<string, unknown>[],
      value.length > MAX_ROWS
    );
  if (value.every(item => Array.isArray(item)))
    return {
      title,
      ...withHeader(
        (value as unknown[][])
          .slice(0, MAX_ROWS)
          .map(row => row.map(cell => cellString(cell)))
      ),
      truncated: value.length > MAX_ROWS,
      extraColumns: 0,
    };
  return null;
}

function objectsToGrid(
  title: string,
  objects: Record<string, unknown>[],
  truncated: boolean
): Grid {
  const source = objects.slice(0, MAX_ROWS);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const object of source) {
    for (const key of Object.keys(object)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (keys.length < MAX_COLUMNS) keys.push(key);
    }
  }
  const rows = source.map(object => keys.map(key => cellString(object[key])));
  return {
    title,
    headers: keys,
    rows,
    truncated: truncated || objects.length > MAX_ROWS,
    extraColumns: Math.max(0, seen.size - keys.length),
  };
}

function cellString(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function withHeader(records: string[][]) {
  if (!records.length)
    return { headers: [] as string[], rows: [] as string[][] };
  const width = Math.min(
    MAX_COLUMNS,
    Math.max(...records.map(row => row.length))
  );
  const first = records[0].slice(0, width).map(cell => cell.trim());
  const labeled =
    first.every(
      cell =>
        classifyCell(cell).kind !== "number" &&
        classifyCell(cell).kind !== "percent"
    ) && first.some(cell => cell.trim());
  const headers = labeled
    ? first.map((cell, index) => cell || `column_${index + 1}`)
    : Array.from({ length: width }, (_, index) => `column_${index + 1}`);
  const body = (labeled ? records.slice(1) : records).map(row =>
    row.slice(0, width)
  );
  return { headers, rows: body };
}

function gridFromRows(title: string, records: string[][]): Grid {
  const extraColumns = Math.max(
    0,
    ...records.map(row => Math.max(0, row.length - MAX_COLUMNS))
  );
  const clipped = records.map(row => row.slice(0, MAX_COLUMNS));
  return {
    title,
    ...withHeader(clipped),
    truncated: records.length > MAX_ROWS,
    extraColumns,
  };
}

type CellKind = "number" | "percent" | "date" | "bool" | "text" | "empty";

function classifyCell(raw: string): {
  kind: CellKind;
  number?: number;
  bool?: boolean;
  date?: string;
} {
  const text = raw.trim();
  if (!text || /^(n\/a|na|null|none|—|-)$/i.test(text))
    return { kind: "empty" };
  if (/^(true|false|yes|no)$/i.test(text))
    return { kind: "bool", bool: /^(true|yes)$/i.test(text) };
  if (
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(
      text
    )
  )
    return { kind: "date", date: text.slice(0, 10) };
  const percent = text.endsWith("%");
  const numeric = (percent ? text.slice(0, -1) : text)
    .trim()
    .replace(/[$£€\s]/g, "")
    .replace(/,/g, "");
  const negative = /^\(.*\)$/.test(numeric);
  const digits = negative ? numeric.slice(1, -1) : numeric;
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(digits)) {
    const number = Number(digits) * (negative ? -1 : 1);
    if (Number.isFinite(number))
      return percent ? { kind: "percent", number } : { kind: "number", number };
  }
  return { kind: "text" };
}

function formatGrid(grid: Grid, others: Grid[]) {
  const rows = grid.rows;
  const headers = grid.headers;
  if (!headers.length) return `${grid.title}: no rows.`;
  const lines = [
    `${grid.title}: ${rows.length.toLocaleString("en-US")} row${rows.length === 1 ? "" : "s"}, ${headers.length} column${headers.length === 1 ? "" : "s"}${grid.truncated ? ` (first ${MAX_ROWS.toLocaleString("en-US")} rows)` : ""}${grid.extraColumns ? `, ${grid.extraColumns} more column${grid.extraColumns === 1 ? "" : "s"} not shown` : ""}.`,
  ];
  headers.forEach((header, index) =>
    lines.push(
      `- ${columnSummary(
        header,
        rows.map(row => row[index] ?? "")
      )}`
    )
  );
  const sample = rows.slice(0, rows.length <= 8 ? rows.length : 3);
  if (sample.length) {
    lines.push(
      "",
      rows.length <= 8 ? "Rows:" : "First rows:",
      headers.join(" | ")
    );
    for (const row of sample)
      lines.push(
        headers
          .map((_, index) =>
            (row[index] ?? "").replace(/\|/g, "/").slice(0, 80)
          )
          .join(" | ")
      );
  }
  if (others.length)
    lines.push(
      "",
      `Other sheets: ${others.map(sheet => `${sheet.title} (${sheet.rows.length.toLocaleString("en-US")} row${sheet.rows.length === 1 ? "" : "s"})`).join(", ")}. Pass sheet to analyze one of them.`
    );
  return lines.join("\n");
}

function columnSummary(header: string, values: string[]) {
  const cells = values.map(classifyCell);
  const filled = cells.filter(cell => cell.kind !== "empty");
  const missing = cells.length - filled.length;
  if (!filled.length) return `${header} (empty): missing ${missing}`;
  const counts = new Map<CellKind, number>();
  for (const cell of filled)
    counts.set(cell.kind, (counts.get(cell.kind) ?? 0) + 1);
  const [dominant] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const mixed = dominant[1] < filled.length * 0.8;
  if (mixed || dominant[0] === "text") {
    const texts = values
      .map(value => value.trim())
      .filter(value => value && !/^(n\/a|na|null|none|—|-)$/i.test(value));
    return `${header} (text): ${distinctPhrase(texts)}, missing ${missing}`;
  }
  if (dominant[0] === "bool") {
    const yes = filled.filter(cell => cell.bool).length;
    return `${header} (yes/no): yes ${yes}, no ${filled.length - yes}, missing ${missing}`;
  }
  if (dominant[0] === "date") {
    const dates = filled
      .map(cell => cell.date!)
      .filter(Boolean)
      .sort();
    return `${header} (date): ${dates[0]} to ${dates[dates.length - 1]}, missing ${missing}`;
  }
  const numbers = filled
    .map(cell => cell.number!)
    .filter(number => number !== undefined);
  // Excel stores a date as a day count. Trust that only when the column is named as a date.
  if (
    dominant[0] === "number" &&
    /date|time/i.test(header) &&
    numbers.every(number => number > 20_000 && number < 80_000)
  ) {
    const dates = numbers.map(excelDate).sort();
    return `${header} (date): ${dates[0]} to ${dates[dates.length - 1]}, missing ${missing}`;
  }
  const stats = numberStats(numbers);
  const unit = dominant[0] === "percent" ? "%" : "";
  return `${header} (${dominant[0] === "percent" ? "percent" : "number"}): min ${stats.min}${unit}, max ${stats.max}${unit}, mean ${stats.mean}${unit}, median ${stats.median}${unit}, missing ${missing}`;
}

function numberStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    min: formatNumber(sorted[0]),
    max: formatNumber(sorted[sorted.length - 1]),
    mean: formatNumber(mean),
    median: formatNumber(median),
  };
}

function excelDate(serial: number) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "n/a";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function distinctPhrase(values: string[]) {
  const counts = new Map<string, number>();
  let overflow = false;
  for (const value of values) {
    if (!counts.has(value) && counts.size >= 200) {
      overflow = true;
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
  const distinct = overflow ? `${counts.size}+` : String(counts.size);
  return `${distinct} distinct${top.length ? `; top: ${top.map(([value, count]) => `${value.slice(0, 40)} (${count})`).join(", ")}` : ""}`;
}

function decodeText(bytes: Buffer) {
  const text = bytes.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksBinary(bytes: Buffer) {
  const sample = bytes.subarray(0, 1000);
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

function clipText(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[Reading truncated at ${max.toLocaleString("en-US")} characters.]`;
}

type KnownKind =
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "csv"
  | "tsv"
  | "json"
  | "text"
  | "doc"
  | "xls"
  | "skip";

function detectKind(filename: string, mime: string): KnownKind {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const type = mime.toLowerCase();
  if (ext === ".pdf" || type === "application/pdf") return "pdf";
  if (ext === ".docx" || type.includes("wordprocessingml")) return "docx";
  if (ext === ".pptx" || type.includes("presentationml")) return "pptx";
  if (ext === ".xlsx" || type.includes("spreadsheetml")) return "xlsx";
  if (ext === ".csv" || type === "text/csv") return "csv";
  if (ext === ".tsv" || type === "text/tab-separated-values") return "tsv";
  if (
    ext === ".json" ||
    ext === ".jsonl" ||
    type === "application/json" ||
    type.endsWith("+json")
  )
    return "json";
  if (ext === ".doc") return "doc";
  if (ext === ".xls") return "xls";
  if (
    [".txt", ".md", ".markdown", ".log"].includes(ext) ||
    type.startsWith("text/")
  )
    return "text";
  return "skip";
}
