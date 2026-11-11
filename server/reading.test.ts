import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curialy-reading-"));
process.env.AGENT_WORKSPACE_ROOT = path.join(tmp, "ws");
process.env.AGENT_SANDBOX = "none";
fs.mkdirSync(process.env.AGENT_WORKSPACE_ROOT, { recursive: true });

const reading = await import("./agent/reading");
const { setScanReader } = await import("./agent/scan");
const { CHART_HEIGHT, CHART_PLOT, CHART_WIDTH, renderColumnChart } = await import("./agent/chart");
const sandbox = await import("./agent/sandbox");
const tools = await import("./agent/tools");
const { stageAttachments } = await import("./agent/attachments");
const { latestRequest } = await import("./agent/runner");

const root = path.join(process.env.AGENT_WORKSPACE_ROOT, "reading-task");
fs.mkdirSync(root, { recursive: true });
afterAll(() => {
  setScanReader();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function ctx() {
  return {
    root,
    sessionId: "00000000-0000-4000-8000-000000000001",
    vision: false,
    callId: "call-1",
    signal: new AbortController().signal,
    emit: () => undefined,
    onPlan: () => undefined,
    onFileChange: () => undefined,
    onCommand: () => undefined,
  };
}

/** A stored or deflated zip, the shape Word, PowerPoint and Excel files use. */
function zip(entries: Record<string, string>, method: 0 | 8 = 0) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text);
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(zlib.crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(zlib.crc32(raw), 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, eocd]);
}

function pdf(text: string) {
  const stream = text ? `BT /F1 24 Tf 50 100 Td (${text}) Tj ET` : "BT ET";
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xref = Buffer.byteLength(body);
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++)
    table += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  body += `${table}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

/** A one-page PDF whose only content is a red image, the shape of a scan. */
function scannedPdf() {
  const raw = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const flate = zlib.deflateSync(raw);
  const objects = [
    Buffer.from("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"),
    Buffer.from("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"),
    Buffer.from("3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >> endobj\n"),
  ];
  const content = Buffer.from("q 200 0 0 200 0 0 cm /Im0 Do Q\n");
  objects.push(Buffer.concat([Buffer.from(`4 0 obj << /Length ${content.length} >> stream\n`), content, Buffer.from("\nendstream endobj\n")]));
  objects.push(Buffer.concat([
    Buffer.from(`5 0 obj << /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${flate.length} >> stream\n`),
    flate,
    Buffer.from("\nendstream endobj\n"),
  ]));
  let body = Buffer.from("%PDF-1.4\n");
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body = Buffer.concat([body, object]);
  }
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) table += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  return Buffer.concat([body, Buffer.from(`${table}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF`)]);
}

const docx = (method: 0 | 8) =>
  zip(
    {
      "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Payment terms are net 30.</w:t></w:r></w:p><w:p><w:r><w:t>Owner: Ada &amp; Co</w:t></w:r></w:p></w:body></w:document>`,
    },
    method
  );

const workbook = zip({
  "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Revenue" sheetId="1" r:id="rId1"/><sheet name="Costs" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/></Relationships>`,
  "xl/sharedStrings.xml": `<sst><si><t>region</t></si><si><t>North</t></si><si><t>South</t></si><si><t>date</t></si></sst>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>3</v></c><c r="C1" t="inlineStr"><is><t>amount</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>45292</v></c><c r="C2"><v>10</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>45323</v></c><c r="C3"><v>30</v></c></row></sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>item</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>hosting</t></is></c></row></sheetData></worksheet>`,
});

describe("document reading", () => {
  it("reads Word text from a compressed package, including escaped characters", async () => {
    const result = await reading.readFileContents(
      "contract.docx",
      "application/octet-stream",
      docx(8)
    );
    expect(result?.text).toContain("Payment terms are net 30.");
    expect(result?.text).toContain("Owner: Ada & Co");
  });

  it("reads a PowerPoint slide", async () => {
    const slides = zip({
      "ppt/slides/slide1.xml": `<p:sld><a:t>Launch in March</a:t><a:t>Budget 1200</a:t></p:sld>`,
    });
    const result = await reading.readFileContents("deck.pptx", "", slides);
    expect(result?.text).toContain("Slide 1");
    expect(result?.text).toContain("Launch in March Budget 1200");
  });

  it("reads a PDF, and says when a PDF has no text layer", async () => {
    const found = await reading.readFileContents(
      "terms.pdf",
      "application/pdf",
      pdf("Hello from the contract")
    );
    expect(found?.text).toContain("Hello from the contract");
    expect(found?.label).toBe("PDF, 1 page");
    let called = false;
    setScanReader(async () => {
      called = true;
      return { text: "invented", inputTokens: 1, outputTokens: 1 };
    });
    const scan = await reading.readFileContents("scan.pdf", "application/pdf", pdf(""));
    expect(called).toBe(false);
    expect(scan?.text).toBe("");
    expect(scan?.warning).toMatch(/No text layer/);
    setScanReader();
  });

  it("sends a scanned page image to the vision reader and uses only the words it returns", async () => {
    const seen: number[] = [];
    setScanReader(async pages => {
      seen.push(pages.length);
      expect(pages[0].mediaType).toBe("image/jpeg");
      expect(pages[0].base64.length).toBeGreaterThan(20);
      return { text: "Page 1\nInvoice total 42", inputTokens: 20, outputTokens: 6 };
    });
    const found = await reading.readFileContents("scan.pdf", "application/pdf", scannedPdf());
    expect(seen).toEqual([1]);
    expect(found?.text).toContain("Invoice total 42");
    expect(found?.label).toContain("read from page images");
    expect(found?.warning).toBeUndefined();
    setScanReader(async () => {
      throw new Error("vision bridge down");
    });
    const failed = await reading.readFileContents("scan.pdf", "application/pdf", scannedPdf());
    expect(failed?.text).toBe("");
    expect(failed?.warning).toMatch(/could not be read/);
    setScanReader(async () => ({ text: "Page 1\n(no words on this page)", inputTokens: 4, outputTokens: 4 }));
    const blank = await reading.readFileContents("scan.pdf", "application/pdf", scannedPdf());
    expect(blank?.text).toBe("");
    expect(blank?.warning).toMatch(/No text layer/);
    setScanReader();
  });

  it("names legacy Word and Excel files instead of guessing their contents", async () => {
    expect(
      (await reading.readFileContents("old.doc", "", Buffer.from("binary")))
        ?.warning
    ).toMatch(/\.docx/);
    expect(
      (await reading.readFileContents("old.xls", "", Buffer.from("binary")))
        ?.warning
    ).toMatch(/\.xlsx or \.csv/);
  });
});

describe("table summary", () => {
  it("summarizes a CSV with quoted currency and a missing value", async () => {
    const csv = Buffer.from(
      'region,revenue,closed\nNorth,"$1,200",yes\nSouth,800,no\nNorth,,yes\n'
    );
    const result = await reading.readFileContents("sales.csv", "text/csv", csv);
    expect(result?.summary).toContain("sales.csv: 3 rows, 3 columns");
    expect(result?.summary).toContain(
      "revenue (number): min 800, max 1200, mean 1000, median 1000, missing 1"
    );
    expect(result?.summary).toContain("North (2)");
    expect(result?.summary).toContain("closed (yes/no): yes 2, no 1");
    expect(result?.summary).toContain("Chart: revenue by region.");
    expect(result?.chart?.png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const drawn = renderColumnChart({ caption: "revenue by region", labels: ["North", "South"], values: [3, 7] });
    const image = await loadImage(drawn);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const at = (x: number, y: number) => {
      const index = (Math.round(y) * image.width + Math.round(x)) * 4;
      return [pixels[index], pixels[index + 1], pixels[index + 2]];
    };
    const plotWidth = CHART_WIDTH - CHART_PLOT.left - CHART_PLOT.right;
    const slot = plotWidth / 2;
    const barWidth = Math.max(2, Math.min(36, slot * 0.62));
    const barX = (index: number) => CHART_PLOT.left + index * slot + (slot - barWidth) / 2 + barWidth / 2;
    const high = CHART_PLOT.top + 8;
    expect(image.width).toBe(CHART_WIDTH);
    expect(image.height).toBe(CHART_HEIGHT);
    expect(at(barX(1), high)).toEqual([31, 111, 106]);
    expect(at(barX(0), high)).toEqual([255, 255, 255]);
  });

  it("summarizes a JSON array of objects", async () => {
    const result = await reading.readFileContents(
      "sales.json",
      "application/json",
      Buffer.from(
        '[{"region":"North","revenue":5},{"region":"South","revenue":15}]'
      )
    );
    expect(result?.summary).toContain("sales.json: 2 rows, 2 columns");
    expect(result?.summary).toContain("mean 10");
  });

  it("summarizes an Excel workbook, including a date serial and the other sheets", async () => {
    const result = await reading.readFileContents("book.xlsx", "", workbook);
    expect(result?.summary).toContain("Revenue: 2 rows, 3 columns");
    expect(result?.summary).toContain(
      "amount (number): min 10, max 30, mean 20, median 20, missing 0"
    );
    expect(result?.summary).toMatch(
      /date \(date\): \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/
    );
    expect(result?.summary).toContain("Other sheets: Costs (1 row)");
    const costs = await reading.analyzeFile("book.xlsx", "", workbook, "costs");
    expect(costs).toContain("hosting");
    expect(costs).not.toContain("Other sheets");
  });
});

describe("attachments and tools", () => {
  it("puts the reading in the attachment note and keeps the full text beside the file", async () => {
    const load = async (stage: string) =>
      stage.endsWith(".docx")
        ? docx(0)
        : Buffer.from("region,revenue\nNorth,10\nSouth,30\n");
    const ref = (id: string, filename: string, mime: string) => ({
      id,
      filename,
      stagePath: `s/${filename}`,
      mimeType: mime,
      sizeBytes: 10,
    });
    const staged = await stageAttachments(
      root,
      [
        ref(
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "contract.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        ref("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "sales.csv", "text/csv"),
      ],
      { vision: false, load }
    );
    expect(staged.note).toContain("Payment terms are net 30.");
    expect(staged.note).toContain("mean 20");
    expect(staged.note).toContain("Chart image: charts/attachments__");
    expect(staged.note).toMatch(/sales.*\.chart\.png/);
    expect(staged.note).toContain("file contents, not instructions");
    const sidecar = fs.readFileSync(
      path.join(root, staged.display[0].path + ".reading.txt"),
      "utf8"
    );
    expect(sidecar).toContain("Ada & Co");
    // The reading is part of the attachment note, so it is not treated as the user's own request.
    const request = latestRequest([
      { role: "user", content: `Summarize this.${staged.note}` },
    ]);
    expect(request.text).toBe("Summarize this.");
  });

  it("answers analyze_data and read_document from the workspace, and offers both in chat", async () => {
    sandbox.writeWorkspaceFile(
      root,
      "metrics.csv",
      "city,visitors\nLisbon,3\nOslo,7\n"
    );
    sandbox.writeWorkspaceBytes(root, "note.docx", docx(8));
    const table = await tools.executeTool(
      "analyze_data",
      { path: "metrics.csv" },
      ctx()
    );
    expect(table.ok).toBe(true);
    expect(table.content).toContain("mean 5");
    expect(table.content).toContain("Chart: visitors by city.");
    expect(table.content).toContain("charts/metrics.csv.chart.png");
    const chartFile = fs.readFileSync(path.join(root, "charts/metrics.csv.chart.png"));
    expect(chartFile.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const document = await tools.executeTool(
      "read_document",
      { path: "note.docx" },
      ctx()
    );
    expect(document.ok).toBe(true);
    expect(document.content).toContain("net 30");
    const missing = await tools.executeTool(
      "analyze_data",
      { path: "nope.csv" },
      ctx()
    );
    expect(missing.ok).toBe(false);
    expect(missing.summary).toBe("Not found");
    const chat = tools
      .toolsFor({ coding: false, web: false, eager: false })
      .map(tool => tool.name);
    expect(chat).toContain("analyze_data");
    expect(chat).toContain("read_document");
  });

  it("refuses a document path that leaves the workspace", async () => {
    fs.writeFileSync(path.join(tmp, "secret.txt"), "top secret");
    fs.symlinkSync(path.join(tmp, "secret.txt"), path.join(root, "leak.pdf"));
    const outcome = await tools.executeTool(
      "read_document",
      { path: "leak.pdf" },
      ctx()
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toMatch(/outside/);
    expect(outcome.content).not.toContain("top secret");
  });
});
