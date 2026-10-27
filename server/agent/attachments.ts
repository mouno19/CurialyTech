import { StorageError } from "../media/storage-errors";
import fs from "node:fs";
import path from "node:path";
import { fetchMediaBytes } from "../media/snowflake";
import { writeWorkspaceBytes } from "./sandbox";

// User attachments (first message or any follow-up): copied into the task workspace under
// attachments/, and, for vision-capable models, images are also sent to the model as image input
// so screenshots are actually seen, not just named.

export type AttachmentRef = { id: string; filename: string; stagePath: string; mimeType: string; sizeBytes: number };
export type AttachmentDisplay = { mediaId: string; filename: string; mimeType: string; sizeBytes: number; path: string };
export type VisionImage = { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; mediaId: string };

const MAX_VISION_BYTES = 3_700_000; // the API's per-image limit is 5 MB of base64
const MAX_VISION_SIDE = 8000; // the API rejects images larger than this on either side
// Whole-request budget (every image in the history is re-sent each turn): stay under the API's
// 32 MB body and 20-image (2000 px) thresholds. Older images are replaced by a note.
const REQUEST_IMAGE_LIMIT = 20;
const REQUEST_IMAGE_BYTES = 20_000_000;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_VISION_IMAGES = 5;
const MAX_VISION_TOTAL = 8_000_000; // per message, so a run's in-memory image cache stays small

/** Detect the real image type from magic bytes (the API rejects a media_type that does not match). */
export function sniffImage(buffer: Buffer): VisionImage["mediaType"] | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Pixel size from the image header (PNG, JPEG, GIF, WebP), or null when it cannot be read. */
export function imageSize(buffer: Buffer): { width: number; height: number } | null {
  try {
    if (buffer.length >= 24 && buffer.readUInt32BE(12) === 0x49484452) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }; // PNG IHDR
    if (buffer.length >= 10 && buffer.subarray(0, 3).toString("latin1") === "GIF") return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    if (buffer.length >= 30 && buffer.subarray(8, 12).toString("latin1") === "WEBP") {
      const chunk = buffer.subarray(12, 16).toString("latin1");
      if (chunk === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") { const bits = buffer.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
      if (chunk === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
      return null;
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset++; continue; }
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
  } catch { /* truncated or malformed header */ }
  return null;
}

/**
 * attachments/<stem>-<id6>.<ext>: the short media id makes every attachment's path unique and
 * stable, even after an archived workspace was restored without some earlier files.
 */
export function uniqueAttachmentPath(root: string, filename: string, mediaId: string) {
  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
  const ext = path.extname(safe);
  const stem = (safe.slice(0, safe.length - ext.length) || "file").slice(0, 80);
  const tag = mediaId.replace(/[^a-z0-9]/gi, "").slice(0, 6);
  for (let index = 1; index < 1000; index++) {
    const candidate = path.join("attachments", `${stem}-${tag}${index === 1 ? "" : `-${index}`}${ext}`);
    if (!fs.existsSync(path.join(root, candidate))) return candidate;
  }
  return path.join("attachments", `${stem}-${tag}-${mediaId}${ext}`);
}

export async function stageAttachments(root: string, refs: AttachmentRef[], opts: { vision: boolean; load?: (stagePath: string) => Promise<Buffer> }) {
  const load = opts.load ?? fetchMediaBytes;
  const display: AttachmentDisplay[] = [];
  const images: VisionImage[] = [];
  const notSeen: string[] = [];
  let visionBytes = 0;
  const failed: string[] = [];
  for (const ref of refs) {
    // One unavailable file should not lose the whole message: report it and keep going.
    let bytes: Buffer;
    try {
      if (ref.sizeBytes > MAX_ATTACHMENT_BYTES) throw new Error("larger than 25 MB");
      bytes = await load(ref.stagePath);
    } catch (error) {
      failed.push(`${ref.filename} (${error instanceof StorageError ? error.message : error instanceof Error && error.message === "larger than 25 MB" ? error.message : "unavailable"})`);
      continue;
    }
    const relative = uniqueAttachmentPath(root, ref.filename, ref.id);
    writeWorkspaceBytes(root, relative, bytes, MAX_ATTACHMENT_BYTES);
    display.push({ mediaId: ref.id, filename: ref.filename, mimeType: ref.mimeType, sizeBytes: bytes.length, path: relative });
    const imageType = sniffImage(bytes);
    if (!imageType) continue;
    const size = imageSize(bytes);
    const fits = size !== null && size.width <= MAX_VISION_SIDE && size.height <= MAX_VISION_SIDE;
    if (opts.vision && fits && bytes.length <= MAX_VISION_BYTES && images.length < MAX_VISION_IMAGES && visionBytes + bytes.length <= MAX_VISION_TOTAL) {
      images.push({ mediaType: imageType, mediaId: ref.id });
      visionBytes += bytes.length;
    } else {
      notSeen.push(`${relative}${opts.vision && !fits ? " (dimensions too large)" : ""}`);
    }
  }
  const lines = display.map(file => `- ${file.path} (${file.mimeType || "file"}, ${file.sizeBytes} bytes)`);
  let note = display.length ? `\n\nAttached files (saved in the workspace):\n${lines.join("\n")}` : "";
  if (images.length) note += `\n${images.length === 1 ? "The attached image is" : `${images.length} attached images are`} included above.`;
  if (notSeen.length) note += `\nNot shown as images (${opts.vision ? "too large or too many" : "this model cannot view images"}): ${notSeen.join(", ")}.`;
  if (failed.length) note += `\nCould not attach: ${failed.join(", ")}.`;
  return { display, images, note };
}

/**
 * User message content in the conversation's wire format. Images are stored as Curialy Vault
 * references, not bytes: the conversation is rewritten to the database every turn, so base64 is
 * attached only to the outgoing request.
 */
/**
 * Load a Vault image for the model: null when it is gone for good (cached as such), one retry only
 * for a network blip, and no retry at all while file storage is known to be down.
 */
async function loadOnce(load: (mediaId: string) => Promise<Buffer | null>, id: string) {
  try {
    return await load(id);
  } catch (error) {
    if (error instanceof StorageError && error.kind === "object_missing") return null;
    if (error instanceof StorageError && error.kind !== "unreachable") throw error;
    return load(id).catch(retryError => {
      if (retryError instanceof StorageError && retryError.kind === "object_missing") return null;
      throw retryError;
    });
  }
}

export function userContent(text: string, images: VisionImage[], format: "anthropic" | "openai") {
  if (!images.length) return text;
  if (format === "openai") {
    return [
      ...images.map(image => ({ type: "image_url", image_url: { url: `${VAULT_SCHEME}${image.mediaId}`, media_type: image.mediaType } })),
      { type: "text", text },
    ];
  }
  return [
    ...images.map(image => ({ type: "image", source: { type: "curialy_vault", media_id: image.mediaId, media_type: image.mediaType } })),
    { type: "text", text },
  ];
}

const VAULT_SCHEME = "curialy-vault:";

/**
 * OpenAI-format counterpart of hydrateImages: Vault references become data URLs, newest first
 * within the same per-request budget; for a model without vision (e.g. after failover) every
 * image becomes a note.
 */
export async function hydrateOpenAIImages<T extends { role: string; content: unknown }>(conversation: T[], cache: Map<string, string>, load: (mediaId: string) => Promise<Buffer | null>, vision: boolean, onIssue?: (message: string) => void): Promise<T[]> {
  const isImage = (part: any) => part?.type === "image_url" && typeof part?.image_url?.url === "string";
  if (!conversation.some(message => Array.isArray(message.content) && (message.content as any[]).some(isImage))) return conversation;
  let count = 0;
  let bytes = 0;
  const wanted = new Set<string>();
  const out: T[] = new Array(conversation.length);
  for (let index = conversation.length - 1; index >= 0; index--) {
    const message = conversation[index];
    if (!Array.isArray(message.content) || !(message.content as any[]).some(isImage)) { out[index] = message; continue; }
    const content = message.content as any[];
    const mapped: any[] = new Array(content.length);
    for (let b = content.length - 1; b >= 0; b--) {
      const part = content[b];
      if (!isImage(part)) { mapped[b] = part; continue; }
      if (!vision) { mapped[b] = { type: "text", text: "[An image was shared here; this model cannot view images.]" }; continue; }
      let url: string = part.image_url.url;
      if (url.startsWith(VAULT_SCHEME)) {
        const id = url.slice(VAULT_SCHEME.length);
        let data = cache.get(id);
        if (data === undefined) {
          try {
            const loaded = await loadOnce(load, id);
            data = loaded ? loaded.toString("base64") : "";
            cache.set(id, data);
          } catch {
            onIssue?.("An attached image could not be loaded this turn; it will be retried.");
            mapped[b] = { type: "text", text: "[An attached image could not be loaded for this turn.]" };
            continue;
          }
        }
        if (!data) { mapped[b] = { type: "text", text: "[An attached image is no longer available.]" }; continue; }
        url = `data:${part.image_url.media_type ?? "image/png"};base64,${data}`;
      }
      if (count >= REQUEST_IMAGE_LIMIT || bytes + url.length > REQUEST_IMAGE_BYTES) { mapped[b] = { type: "text", text: "[Earlier image omitted from this request to stay within image limits.]" }; continue; }
      count++;
      bytes += url.length;
      if (part.image_url.url.startsWith(VAULT_SCHEME)) wanted.add(part.image_url.url.slice(VAULT_SCHEME.length)); // cache only what is still sent
      mapped[b] = { type: "image_url", image_url: { url } };
    }
    out[index] = { ...message, content: mapped };
  }
  for (const id of Array.from(cache.keys())) if (!wanted.has(id) && cache.get(id)) cache.delete(id);
  return out;
}

type VaultImageBlock = { type: "image"; source: { type: "curialy_vault"; media_id: string; media_type: VisionImage["mediaType"] } };
const isVaultImage = (block: any): block is VaultImageBlock => block?.type === "image" && block?.source?.type === "curialy_vault";

/**
 * Copy of the conversation with Vault image references replaced by base64 image blocks for the
 * API. `cache` (one per run) avoids re-downloading on every turn; images that can no longer be
 * loaded become a short text note so the request stays valid.
 */
export async function hydrateImages<T extends { role: string; content: unknown }>(conversation: T[], cache: Map<string, string>, load: (mediaId: string) => Promise<Buffer | null>, onIssue?: (message: string) => void): Promise<T[]> {
  const isInlineImage = (block: any) => block?.type === "image" && block?.source?.type === "base64";
  const hasImages = conversation.some(message => Array.isArray(message.content) && (message.content as any[]).some(block =>
    isVaultImage(block) || isInlineImage(block) || (block?.type === "tool_result" && Array.isArray(block.content) && block.content.some(isInlineImage))));
  if (!hasImages) return conversation;

  // Newest first: the most recent images are the ones that matter; older ones become a note.
  let count = 0;
  let bytes = 0;
  const admit = (size: number) => {
    if (count >= REQUEST_IMAGE_LIMIT || bytes + size > REQUEST_IMAGE_BYTES) return false;
    count++;
    bytes += size;
    return true;
  };
  const omitted = (label: string) => ({ type: "text", text: `[Earlier ${label} omitted from this request to stay within image limits.]` });
  const wanted = new Set<string>();
  const out: T[] = new Array(conversation.length);
  for (let index = conversation.length - 1; index >= 0; index--) {
    const message = conversation[index];
    if (!Array.isArray(message.content)) { out[index] = message; continue; }
    const content = message.content as any[];
    if (!content.some(block => isVaultImage(block) || isInlineImage(block) || block?.type === "tool_result")) { out[index] = message; continue; }
    const mapped: any[] = new Array(content.length);
    for (let b = content.length - 1; b >= 0; b--) {
      const block = content[b];
      if (isVaultImage(block)) {
        const id = block.source.media_id;
        let data = cache.get(id);
        if (data === undefined) {
          try {
            const loaded = await loadOnce(load, id);
            data = loaded ? loaded.toString("base64") : "";
            cache.set(id, data); // cache successes and definite "not found" only
          } catch {
            onIssue?.("An attached image could not be loaded this turn; it will be retried.");
            mapped[b] = { type: "text", text: "[An attached image could not be loaded for this turn.]" };
            continue;
          }
        }
        if (!data) { mapped[b] = { type: "text", text: "[An attached image is no longer available.]" }; continue; }
        if (admit(data.length)) { wanted.add(id); mapped[b] = { type: "image", source: { type: "base64", media_type: block.source.media_type, data } }; }
        else mapped[b] = omitted("attached image");
      } else if (isInlineImage(block)) {
        mapped[b] = admit(block.source.data.length) ? block : omitted("image");
      } else if (block?.type === "tool_result" && Array.isArray(block.content) && block.content.some(isInlineImage)) {
        const inner = [...block.content].reverse().map((part: any) => (isInlineImage(part) && !admit(part.source.data.length) ? omitted("screenshot") : part)).reverse();
        mapped[b] = { ...block, content: inner };
      } else {
        mapped[b] = block;
      }
    }
    out[index] = { ...message, content: mapped };
  }
  // Keep the run cache bounded to images that are still being sent.
  for (const id of Array.from(cache.keys())) if (!wanted.has(id) && cache.get(id)) cache.delete(id);
  return out;
}
