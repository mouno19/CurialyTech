import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { canvaRequest, connectedIdentity } from "../services/canva";
import { askApproval } from "./requests";
import { clip } from "./sandbox";
import { taskOwner } from "./store";
import type { ToolContext, ToolOutcome } from "./tools";

// The agent's Canva tools, always with the connection of the account that owns the task (looked up
// from the task, never taken from the model's input). They talk to a CanvaBackend: the Connect REST
// API today; Canva's remote MCP server (https://mcp.canva.com/mcp) can be added as another backend
// behind the same interface without changing the tools or the agent. Creating a design is a change
// in the user's Canva account: it shows exactly what will be created and waits for their approval.

export type CanvaDesign = { id: string; title: string | null; types: string[]; pageCount: number | null; createdAt: number | null; updatedAt: number | null; editUrl: string | null; viewUrl: string | null };
export type CanvaFolderEntry = { kind: "folder" | "design" | "image" | "other"; id: string; name: string | null; updatedAt: number | null };
export type CanvaDesignType = { preset: "doc" | "email" | "presentation" | "whiteboard" } | { width: number; height: number };
export type CreateDesignInput = { title: string; type: CanvaDesignType; assetId?: string };

/** What the tools need from Canva, whichever way it is reached. */
export interface CanvaBackend {
  readonly name: string;
  /** The scopes the account granted. */
  scopes(): Promise<string[]>;
  listDesigns(opts: { query?: string; ownership?: "any" | "owned" | "shared"; sortBy?: string; limit: number; continuation?: string }): Promise<{ designs: CanvaDesign[]; continuation: string | null }>;
  getDesign(id: string): Promise<CanvaDesign>;
  listFolder(folderId: string, opts: { itemTypes?: string[]; limit: number; continuation?: string }): Promise<{ items: CanvaFolderEntry[]; continuation: string | null }>;
  createDesign(input: CreateDesignInput): Promise<CanvaDesign>;
  /** Needs folder:write. */
  moveToFolder(itemId: string, folderId: string): Promise<void>;
}

const text = (value: unknown, max = 200) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function toDesign(raw: any): CanvaDesign {
  return {
    id: String(raw?.id ?? ""),
    title: text(raw?.title),
    types: Array.isArray(raw?.design_types) ? raw.design_types.filter((item: unknown) => typeof item === "string") : [],
    pageCount: number(raw?.page_count),
    createdAt: number(raw?.created_at),
    updatedAt: number(raw?.updated_at),
    editUrl: text(raw?.urls?.edit_url, 2000),
    viewUrl: text(raw?.urls?.view_url, 2000),
  };
}

function toEntry(raw: any): CanvaFolderEntry {
  if (raw?.type === "folder") return { kind: "folder", id: String(raw.folder?.id ?? ""), name: text(raw.folder?.name), updatedAt: number(raw.folder?.updated_at) };
  if (raw?.type === "design") return { kind: "design", id: String(raw.design?.id ?? ""), name: text(raw.design?.title), updatedAt: number(raw.design?.updated_at) };
  if (raw?.type === "image") return { kind: "image", id: String(raw.image?.id ?? ""), name: text(raw.image?.name), updatedAt: number(raw.image?.updated_at) };
  return { kind: "other", id: String(raw?.[raw?.type]?.id ?? ""), name: text(raw?.[raw?.type]?.name ?? raw?.[raw?.type]?.title), updatedAt: null };
}

/** The Connect REST API, with this account's own token. */
export function restCanvaBackend(userId: string, signal?: AbortSignal): CanvaBackend {
  const get = (path: string, query?: Record<string, any>) => canvaRequest(userId, "GET", path, { query, signal });
  const post = (path: string, body: unknown) => canvaRequest(userId, "POST", path, { body, signal });
  return {
    name: "Canva Connect API",
    scopes: async () => (await connectedIdentity(userId))?.scopes ?? [],
    listDesigns: async opts => {
      const body = await get("/v1/designs", { query: opts.query, ownership: opts.ownership, sort_by: opts.sortBy, limit: opts.limit, continuation: opts.continuation });
      return { designs: (Array.isArray(body?.items) ? body.items : []).map(toDesign), continuation: text(body?.continuation, 2000) };
    },
    getDesign: async id => toDesign((await get(`/v1/designs/${encodeURIComponent(id)}`))?.design),
    listFolder: async (folderId, opts) => {
      const body = await get(`/v1/folders/${encodeURIComponent(folderId)}/items`, { item_types: opts.itemTypes, limit: opts.limit, continuation: opts.continuation });
      return { items: (Array.isArray(body?.items) ? body.items : []).map(toEntry), continuation: text(body?.continuation, 2000) };
    },
    createDesign: async input => {
      const designType = "preset" in input.type ? { type: "preset", name: input.type.preset } : { type: "custom", width: input.type.width, height: input.type.height };
      const body = await post("/v1/designs", { type: "type_and_asset", design_type: designType, title: input.title, ...(input.assetId ? { asset_id: input.assetId } : {}) });
      return toDesign(body?.design);
    },
    moveToFolder: async (itemId, folderId) => { await post("/v1/folders/move", { item_id: itemId, to_folder_id: folderId }); },
  };
}

/** The backend for an account: REST today (an MCP backend would be chosen here). */
export function canvaBackendFor(userId: string, signal?: AbortSignal): CanvaBackend {
  return restCanvaBackend(userId, signal);
}

// ---- The tools ----

const canvaId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,50}$/, "a Canva id (letters, digits, _ and -)");
const PRESETS = ["doc", "email", "presentation", "whiteboard"] as const;
const PRESET_LABEL: Record<(typeof PRESETS)[number], string> = { doc: "Canva Doc", email: "Email", presentation: "Presentation", whiteboard: "Whiteboard" };
/** Canva's limits for a custom design. */
const MIN_SIDE = 40;
const MAX_SIDE = 8000;
const MAX_AREA = 25_000_000;

export const CANVA_SCHEMAS = {
  canva_list_designs: z.object({
    query: z.string().trim().max(255).optional(),
    ownership: z.enum(["any", "owned", "shared"]).optional(),
    sort_by: z.enum(["relevance", "modified_descending", "modified_ascending", "title_descending", "title_ascending"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    continuation: z.string().trim().max(2000).optional(),
  }),
  canva_get_design: z.object({ design_id: canvaId }),
  canva_list_folder: z.object({
    folder_id: canvaId.default("root"),
    item_types: z.array(z.enum(["design", "folder", "image"])).max(3).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    continuation: z.string().trim().max(2000).optional(),
  }),
  canva_create_design: z.object({
    title: z.string().trim().min(1).max(255),
    preset: z.enum(PRESETS).optional(),
    width: z.coerce.number().int().min(MIN_SIDE).max(MAX_SIDE).optional(),
    height: z.coerce.number().int().min(MIN_SIDE).max(MAX_SIDE).optional(),
    asset_id: canvaId.optional(),
    folder_id: canvaId.optional(),
  }).refine(value => Boolean(value.preset) !== Boolean(value.width || value.height), { message: "Pass either preset, or width and height for a custom size (not both)." })
    .refine(value => Boolean(value.preset) || (value.width !== undefined && value.height !== undefined), { message: "A custom size needs both width and height." })
    .refine(value => !value.width || !value.height || value.width * value.height <= MAX_AREA, { message: `A custom design can be at most ${MAX_AREA.toLocaleString("en-US")} pixels in area (5000 × 5000).` }),
};

export type CanvaToolName = keyof typeof CANVA_SCHEMAS;
export const CANVA_TOOL_NAMES = Object.keys(CANVA_SCHEMAS) as CanvaToolName[];
export const CANVA_READ_TOOLS = CANVA_TOOL_NAMES.filter(name => name !== "canva_create_design");

export const CANVA_TOOLS: (Anthropic.Tool & { name: CanvaToolName })[] = [
  {
    name: "canva_list_designs",
    description: "List or search the user's Canva designs (their own and those shared with them): title, id, type, pages and when it changed. query searches titles and content. Pass continuation from a previous answer for the next page.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        ownership: { type: "string", enum: ["any", "owned", "shared"] },
        sort_by: { type: "string", enum: ["relevance", "modified_descending", "modified_ascending", "title_descending", "title_ascending"] },
        limit: { type: "number", description: "1-100, default 20" },
        continuation: { type: "string" },
      },
    },
  },
  {
    name: "canva_get_design",
    description: "One Canva design's details: title, type, page count, when it was created and changed, and its edit and view links (they work for this user only and last 30 days).",
    input_schema: { type: "object", properties: { design_id: { type: "string" } }, required: ["design_id"] },
  },
  {
    name: "canva_list_folder",
    description: "What a Canva folder holds: folders, designs and images, with their ids. folder_id: root (the top of the user's Projects, the default), uploads, or a folder's id.",
    input_schema: {
      type: "object",
      properties: {
        folder_id: { type: "string" },
        item_types: { type: "array", items: { type: "string", enum: ["design", "folder", "image"] } },
        limit: { type: "number", description: "1-100, default 50" },
        continuation: { type: "string" },
      },
    },
  },
  {
    name: "canva_create_design",
    description: "Create a new, blank Canva design in the user's account: a title, and either a preset type (doc, email, presentation, whiteboard) or a custom width and height in pixels (40-8000 each, at most 25,000,000 in area). asset_id: an image from the user's Canva uploads to place in it. Returns the link to open it in Canva. It can't add text, shapes or other content: the user edits the design in Canva. The user is shown the exact title, type and size and must approve it first.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        preset: { type: "string", enum: [...PRESETS] },
        width: { type: "number" },
        height: { type: "number" },
        asset_id: { type: "string", description: "An image asset id (from canva_list_folder)" },
        folder_id: { type: "string", description: "Put it in this folder (needs the folder:write permission)" },
      },
      required: ["title"],
    },
  },
];

const when = (seconds: number | null) => (seconds ? `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC` : null);

const designLine = (design: CanvaDesign) => `- ${[design.title ?? "(untitled)", design.id, design.types.join("/") || null, design.pageCount !== null ? `${design.pageCount} page(s)` : null, when(design.updatedAt) ? `changed ${when(design.updatedAt)}` : null].filter(Boolean).join(" · ")}`;

type Ctx = Pick<ToolContext, "sessionId" | "emit" | "signal">;

/** One of the Canva tools, for the account that owns the task. backend: tests. */
export async function runCanvaTool(name: CanvaToolName, input: unknown, ctx: Ctx, backendFor: (userId: string, signal?: AbortSignal) => CanvaBackend = canvaBackendFor): Promise<ToolOutcome> {
  const owner = await taskOwner(ctx.sessionId);
  const identity = owner ? await connectedIdentity(owner).catch(() => null) : null;
  if (!owner || !identity) return { ok: false, content: "Canva isn't connected (or the connection needs renewing). Ask the user to click Connect Canva in the sidebar.", summary: "Canva not connected" };
  const canva = backendFor(owner, ctx.signal);
  switch (name) {
    case "canva_list_designs": {
      const { query, ownership, sort_by: sortBy, limit, continuation } = input as z.infer<typeof CANVA_SCHEMAS.canva_list_designs>;
      const { designs, continuation: next } = await canva.listDesigns({ query, ownership, sortBy, limit, continuation });
      const lines = [designs.length ? `${designs.length} Canva design(s)${query ? ` matching "${query}"` : ""}:` : `No Canva designs${query ? ` match "${query}"` : ""}.`, ...designs.map(designLine), next ? `More: pass continuation "${next}".` : null];
      return { ok: true, content: clip(lines.filter(Boolean).join("\n"), 12_000), summary: `${designs.length} design(s)` };
    }
    case "canva_get_design": {
      const design = await canva.getDesign((input as z.infer<typeof CANVA_SCHEMAS.canva_get_design>).design_id);
      const lines = [
        `${design.title ?? "(untitled)"} (${design.id})`,
        design.types.length ? `Type: ${design.types.join(", ")}` : null,
        design.pageCount !== null ? `Pages: ${design.pageCount}` : null,
        when(design.createdAt) ? `Created: ${when(design.createdAt)}` : null,
        when(design.updatedAt) ? `Changed: ${when(design.updatedAt)}` : null,
        design.editUrl ? `Edit in Canva: ${design.editUrl}` : null,
        design.viewUrl ? `View: ${design.viewUrl}` : null,
        "(The links work for this user only, for 30 days.)",
      ];
      return { ok: true, content: lines.filter(Boolean).join("\n"), summary: design.title ?? design.id };
    }
    case "canva_list_folder": {
      const { folder_id: folderId, item_types: itemTypes, limit, continuation } = input as z.infer<typeof CANVA_SCHEMAS.canva_list_folder>;
      const { items, continuation: next } = await canva.listFolder(folderId, { itemTypes, limit, continuation });
      const where = folderId === "root" ? "the top of your Projects" : folderId === "uploads" ? "Uploads" : `folder ${folderId}`;
      const lines = [items.length ? `${items.length} item(s) in ${where}:` : `Nothing in ${where}.`, ...items.map(item => `- ${item.kind} · ${item.name ?? "(untitled)"} · ${item.id}${when(item.updatedAt) ? ` · changed ${when(item.updatedAt)}` : ""}`), next ? `More: pass continuation "${next}".` : null];
      return { ok: true, content: clip(lines.filter(Boolean).join("\n"), 12_000), summary: `${items.length} item(s)` };
    }
    case "canva_create_design": {
      const { title, preset, width, height, asset_id: assetId, folder_id: folderId } = input as z.infer<typeof CANVA_SCHEMAS.canva_create_design>;
      const type: CanvaDesignType = preset ? { preset } : { width: width!, height: height! };
      // Canva creates designs at the top of the user's Projects; a folder needs a move (folder:write).
      const folder = folderId && folderId !== "root" ? folderId : null;
      if (folder && !(await canva.scopes()).includes("folder:write")) {
        return { ok: false, content: `Nothing was created: Canva's create-design API has no folder option, and moving the design into folder ${folder} needs the folder:write permission, which this Canva connection doesn't have (it has to be enabled for the app in the Canva Developer Portal, then the user reconnects). Tell the user, or create it without folder_id: it then goes to the top of their Projects.`, summary: "Folder needs folder:write" };
      }
      const typeLine = preset ? `Type: ${PRESET_LABEL[preset]} (Canva preset)` : "Type: custom size";
      const sizeLine = preset ? `Size: Canva's standard size for a ${PRESET_LABEL[preset].toLowerCase()}` : `Size: ${width} × ${height} px`;
      const approval = await askApproval({ taskId: ctx.sessionId, emit: ctx.emit, signal: ctx.signal }, {
        action: name,
        service: "Canva",
        title: `Create the Canva design "${title}"`,
        details: [
          `Title: ${title}`,
          typeLine,
          sizeLine,
          assetId ? `Image: asset ${assetId}, placed in the design` : "Content: blank (no text or images)",
          `Where: ${folder ? `folder ${folder}` : "the top of your Projects"}${identity.name ? ` in ${identity.name}'s Canva` : ""}`,
          "Canva deletes a blank design after 7 days if nobody edits it.",
        ],
      }, { autoApprove: false, once: true });
      if (!approval.approved) return { ok: false, declined: true, content: approval.message, summary: "Not approved" };
      const design = await canva.createDesign({ title, type, ...(assetId ? { assetId } : {}) });
      let moved = "";
      if (folder) {
        try {
          await canva.moveToFolder(design.id, folder);
          moved = ` It is in folder ${folder}.`;
        } catch (error) {
          moved = ` It was created at the top of Projects, but moving it into folder ${folder} failed: ${error instanceof Error ? error.message : "an error"}`;
        }
      }
      return {
        ok: true,
        content: [
          `Created "${design.title ?? title}" (${design.id}).${moved}`,
          design.editUrl ? `Open it in Canva to edit: ${design.editUrl}` : null,
          design.viewUrl ? `View: ${design.viewUrl}` : null,
          "Give the user the edit link. It works for them only, for 30 days. The design is blank apart from any image: they add content in Canva.",
        ].filter(Boolean).join("\n"),
        summary: `Created ${design.id}`,
      };
    }
  }
}
