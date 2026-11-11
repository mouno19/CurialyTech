import type { PDFDocumentProxy } from "unpdf/pdfjs";
import { anthropicClient } from "./providers";

// A scanned PDF has no text layer. Its pages are rendered to images and read by a vision
// model. No OCR package is installed. If the model returns no words, the file stays unread.

export const SCAN_MODEL = "claude-haiku-5-5";
const MAX_PAGES = 4;
const PAGE_WIDTH = 900;

export type ScanPage = { page: number; mediaType: "image/jpeg"; base64: string };
export type ScanReading = { text: string; inputTokens: number; outputTokens: number };
export type ScanReader = (pages: ScanPage[], signal?: AbortSignal) => Promise<ScanReading | null>;

let reader: ScanReader = readPagesWithVision;

/** Tests replace the vision call. Omit the argument to restore the real model. */
export function setScanReader(next?: ScanReader) {
  reader = next ?? readPagesWithVision;
}

export type ScanTranscript = { text: string; usage?: { model: string; inputTokens: number; outputTokens: number }; failed: boolean };

/**
 * Render pages that contain an image and ask the vision model for the words on them.
 * `failed` is false when the PDF simply has no page images (nothing was sent).
 */
export async function transcribeScannedPdf(pdf: PDFDocumentProxy, signal?: AbortSignal): Promise<ScanTranscript> {
  let pages: ScanPage[];
  let omitted = 0;
  try {
    const rendered = await renderScanPages(pdf, signal);
    pages = rendered.pages;
    omitted = rendered.omitted;
  } catch (error) {
    console.error("[reading] scan render:", error instanceof Error ? error.message : error);
    return { text: "", failed: true };
  }
  if (!pages.length) return { text: "", failed: false };
  let reading: ScanReading | null;
  try {
    reading = await reader(pages, signal);
  } catch (error) {
    console.error("[reading] scan vision:", error instanceof Error ? error.message : error);
    return { text: "", failed: true };
  }
  const text = cleanTranscript(reading?.text ?? "");
  if (!text) return { text: "", failed: !reading };
  const more = omitted > 0 ? `\n\n[${omitted} later page${omitted === 1 ? "" : "s"} with images ${omitted === 1 ? "was" : "were"} not sent.]` : "";
  return {
    text: `${text}${more}`,
    failed: false,
    usage: reading ? { model: SCAN_MODEL, inputTokens: reading.inputTokens, outputTokens: reading.outputTokens } : undefined,
  };
}

async function renderScanPages(pdf: PDFDocumentProxy, signal?: AbortSignal) {
  const { inspectPages, renderPageAsImage } = await import("unpdf");
  const inspected = await inspectPages(pdf);
  const withImages = inspected.pages
    .map((page, index) => ({ page: index + 1, images: page.imageCount }))
    .filter(page => page.images > 0);
  const chosen = withImages.slice(0, MAX_PAGES);
  const pages: ScanPage[] = [];
  for (const item of chosen) {
    if (signal?.aborted) break;
    const jpeg = Buffer.from(await renderPageAsImage(pdf, item.page, {
      canvasImport: () => import("@napi-rs/canvas"),
      width: PAGE_WIDTH,
      format: "jpeg",
      quality: 0.62,
    }));
    if (jpeg.length > 1_200_000) {
      const smaller = Buffer.from(await renderPageAsImage(pdf, item.page, {
        canvasImport: () => import("@napi-rs/canvas"),
        width: 640,
        format: "jpeg",
        quality: 0.5,
      }));
      if (!(await pageHasInk(smaller))) continue;
      pages.push({ page: item.page, mediaType: "image/jpeg", base64: smaller.toString("base64") });
      continue;
    }
    if (!(await pageHasInk(jpeg))) continue;
    pages.push({ page: item.page, mediaType: "image/jpeg", base64: jpeg.toString("base64") });
  }
  return { pages, omitted: Math.max(0, withImages.length - MAX_PAGES) };
}

/** A blank rendered page is not sent. A scan of a document is mostly not white. */
async function pageHasInk(jpeg: Buffer) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(jpeg);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  let ink = 0;
  let seen = 0;
  for (let index = 0; index < pixels.length; index += 16) {
    seen++;
    if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) ink++;
  }
  return seen > 0 && ink / seen > 0.004;
}

async function readPagesWithVision(pages: ScanPage[], signal?: AbortSignal): Promise<ScanReading | null> {
  const content: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }> = [];
  for (const page of pages) {
    content.push({ type: "text", text: `Page ${page.page}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: page.base64 } });
  }
  content.push({ type: "text", text: "Transcribe the words on these scanned pages." });
  const message = await anthropicClient("core").messages.create({
    model: SCAN_MODEL,
    max_tokens: 4096,
    system: "You transcribe scanned document pages. Write only the words visible in the images, in reading order. Keep short line breaks. Do not add, guess, or complete words that are not visible. If a page has no words, write \"(no words on this page)\" for it. Begin each page with the Page N label that was given beside its image.",
    messages: [{ role: "user", content }],
  }, { signal, timeout: 60_000 });
  const text = message.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
  return { text, inputTokens: message.usage.input_tokens ?? 0, outputTokens: message.usage.output_tokens ?? 0 };
}

function cleanTranscript(text: string) {
  const body = text.replace(/\(no words on this page\)/gi, "").replace(/^Page \d+\s*$/gim, "").trim();
  return body ? text.trim() : "";
}
