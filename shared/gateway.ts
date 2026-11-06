// The Developer API: models a key can call, the key format, and the public base URL. Shared by the
// gateway (server/gateway) and the Developer API page, so both always list the same models.

/** format: the API a model speaks. Claude models answer on both endpoints; the others on /v1/chat/completions. */
export type GatewayModel = { id: string; label: string; format: "anthropic" | "openai" };

export const GATEWAY_MODELS: GatewayModel[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", format: "anthropic" },
  { id: "claude-opus-5", label: "Claude Opus 5", format: "anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", format: "anthropic" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", format: "anthropic" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", format: "anthropic" },
  { id: "claude-opus-4-5", label: "Claude Opus 4.5", format: "anthropic" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", format: "anthropic" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", format: "anthropic" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", format: "anthropic" },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", format: "anthropic" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", format: "anthropic" },
  { id: "openai-gpt-5.5", label: "OpenAI GPT 5.5", format: "openai" },
  { id: "openai-gpt-5.4", label: "OpenAI GPT 5.4", format: "openai" },
  { id: "openai-gpt-5.2", label: "OpenAI GPT 5.2", format: "openai" },
  { id: "openai-gpt-5", label: "OpenAI GPT 5", format: "openai" },
  { id: "grok-4.7", label: "Grok 4.7", format: "openai" },
  { id: "grok-4.6", label: "Grok 4.6", format: "openai" },
  { id: "kimi-k3", label: "Kimi K3", format: "openai" },
  { id: "glm-5.3", label: "GLM 5.3", format: "openai" },
];

export const gatewayModel = (id: string) => GATEWAY_MODELS.find(model => model.id === id);

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
