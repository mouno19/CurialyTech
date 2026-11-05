// The Developer API: models a key can call, the key format, and the public base URL. Shared by the
// gateway (server/gateway) and the Developer API page, so both always list the same models.

export type GatewayModel = { id: string; label: string };

export const GATEWAY_MODELS: GatewayModel[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
];

export const GATEWAY_MODEL_IDS = GATEWAY_MODELS.map(model => model.id);

/** `cur_live_` and 32 hex characters (128 random bits). */
export const API_KEY_PATTERN = /^cur_live_[0-9a-f]{32}$/;

/** What the page shows of a key after creation: `cur_live_` and its first four hex characters. */
export const API_KEY_PREFIX_LENGTH = 13;

export const MAX_ACTIVE_KEYS = 10;

export const GATEWAY_BASE_URL = "https://curialy.tech/v1";

export type ApiKeyInfo = {
  id: string;
  name: string;
  prefix: string;
  allowedModels: string[];
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
};
