import zlib from "node:zlib";

// One bar chart from numbers the table summary already classified. Drawn here so a task
// does not install a chart library to answer "chart this".

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 360;
export const CHART_PLOT = { left: 52, right: 16, top: 28, bottom: 40 };

const INK: [number, number, number] = [31, 111, 106];
const AXIS: [number, number, number] = [40, 48, 56];

/** Where a chart for this workspace file is saved. */
export function chartPathFor(relative: string) {
  const safe = relative
    .replace(/[\\/]+/g, "__")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 140);
  return `charts/${safe || "table"}.chart.png`;
}

/** 5×7 glyphs, rows of 5 bits. Unknown characters are skipped. */
const GLYPHS: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 6, 6],
  ",": [0, 0, 0, 0, 0, 6, 4],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "%": [25, 26, 4, 8, 16, 22, 19],
  "/": [1, 2, 4, 8, 16, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  ":": [0, 6, 6, 0, 6, 6, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [14, 17, 1, 6, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [14, 17, 16, 14, 1, 17, 14],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 10, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};

export function renderColumnChart(input: { caption: string; labels: string[]; values: number[] }): Buffer {
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const plot = CHART_PLOT;
  const pixels = Buffer.alloc(width * height * 4, 255);
  const values = input.values;
  const finite = values.filter(value => Number.isFinite(value));
  const dataMax = finite.length ? Math.max(...finite) : 0;
  const dataMin = finite.length ? Math.min(...finite) : 0;
  const axisMin = dataMin >= 0 ? 0 : dataMin;
  let axisMax = dataMax <= 0 && dataMin < 0 ? 0 : dataMax;
  if (axisMax === axisMin) axisMax = axisMin + 1;
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const plotBottom = height - plot.bottom;
  const yOf = (value: number) => plotBottom - ((value - axisMin) / (axisMax - axisMin)) * plotHeight;

  const set = (x: number, y: number, color: [number, number, number]) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const index = (py * width + px) * 4;
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = 255;
  };
  const hline = (y: number, x0: number, x1: number, color: [number, number, number]) => {
    for (let x = x0; x <= x1; x++) set(x, y, color);
  };
  const vline = (x: number, y0: number, y1: number, color: [number, number, number]) => {
    const start = Math.min(y0, y1);
    const end = Math.max(y0, y1);
    for (let y = start; y <= end; y++) set(x, y, color);
  };
  const glyph = (char: string, x: number, y: number) => {
    const rows = GLYPHS[char];
    if (!rows) return;
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < 5; col++) if (rows[row] & (1 << (4 - col))) set(x + col, y + row, AXIS);
    }
  };
  const label = (text: string, x: number, y: number) => {
    let cursor = x;
    for (const char of text.toUpperCase()) {
      if (GLYPHS[char]) {
        glyph(char, cursor, y);
        cursor += 6;
      }
    }
  };

  label(input.caption.slice(0, 42), plot.left, 8);
  hline(plot.top, plot.left, width - plot.right, AXIS);
  hline(plotBottom, plot.left, width - plot.right, AXIS);
  vline(plot.left, plot.top, plotBottom, AXIS);
  const zero = yOf(Math.min(axisMax, Math.max(axisMin, 0)));
  hline(zero, plot.left, width - plot.right, [210, 214, 216]);
  label(formatTick(axisMax), 2, plot.top);
  label(formatTick(axisMin), 2, plotBottom - 7);

  const count = Math.max(values.length, 1);
  const slot = plotWidth / count;
  const barWidth = Math.max(2, Math.min(36, slot * 0.62));
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = plot.left + index * slot + (slot - barWidth) / 2;
    const top = yOf(value);
    const base = zero;
    for (let px = 0; px < barWidth; px++) vline(x + px, top, base, INK);
    const name = (input.labels[index] ?? "").replace(/[^A-Za-z0-9 .%-]/g, "").slice(0, 8);
    if (count <= 12 && name) label(name, x, plotBottom + 8);
  });
  return encodePng(width, height, pixels);
}

function formatTick(value: number) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).slice(0, 8);
}

function encodePng(width: number, height: number, rgba: Buffer) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
