// Shared contract between the agent runtime (server/agent) and the glassbox UI.

export type ProviderId = "core" | "core-chat" | "core-inference" | "core-sql" | "relay" | "fast" | "research";
/** Engine family, used internally (Integrations page, failover routes); never shown on a model. */
export type ModelGroup = "Core" | "Relay" | "Fast" | "Research" | "Gemini";
export type ThinkingLevel = "low" | "medium" | "high";
export type TaskMode = "agent" | "chat";
/** Dev Team mode roles. */
export type TeamRole = "architect" | "engineer" | "reviewer";
export const TEAM_ROLES: { id: TeamRole; label: string; title: string; defaultModel: string }[] = [
  { id: "architect", label: "Architect", title: "Plans and maps dependencies", defaultModel: "claude-opus-5-5" },
  { id: "engineer", label: "Engineer", title: "Implements the plan", defaultModel: "auto" },
  { id: "reviewer", label: "Reviewer", title: "Reviews the code and runs the tests", defaultModel: "claude-opus-5" },
];
export type TeamPlan = { summary: string; steps: { title: string; detail: string; acceptance: string }[]; risks: string[]; test_plan: string };
export type TeamReview = { verdict: "approve" | "request_changes"; summary: string; issues: { severity: "blocker" | "major" | "minor"; file?: string; description: string; suggestion: string }[]; tests_run: { command: string; result: string }[] };

export type ModelSpec = {
  id: string;
  label: string;
  provider: ProviderId;
  group: ModelGroup;
  /** Accepts client tools (required for agent mode). */
  tools: boolean;
  /**
   * How thinking is requested/streamed: Anthropic adaptive (+summarized display), Anthropic
   * budgeted (4.5 generation, no adaptive), OpenAI-style reasoning_content, or none.
   */
  thinking: "adaptive-summarized" | "adaptive" | "budget" | "reasoning-content" | "none";
  /** Accepts output_config.effort (Anthropic format) or reasoning_effort (OpenAI format). */
  effort: boolean;
  /** Accepts eager_input_streaming on tools (the 4.5 generation rejects the field outright). */
  eagerInput: boolean;
  /** Accepts images (attachments, screenshots). */
  vision: boolean;
  /** One picker entry backed by an API model per thinking level (Gemini 3.8 Flash high/medium/low). */
  variants?: Record<ThinkingLevel, string>;
  /** Not in the picker: internal routes (failover, Research Agent) and legacy ids old tasks still use. */
  hidden?: boolean;
};

type Flags = Partial<Omit<ModelSpec, "id" | "label">>;
const claude = (id: string, label: string, flags: Flags = {}): ModelSpec => ({ id, label, provider: "core", group: "Core", tools: true, thinking: "adaptive-summarized", effort: true, eagerInput: true, vision: true, ...flags });
// Cortex's OpenAI-compatible chat/completions endpoint.
const chat = (id: string, label: string, flags: Flags = {}): ModelSpec => ({ id, label, provider: "core-chat", group: "Core", tools: true, thinking: "none", effort: true, eagerInput: false, vision: true, ...flags });
// Chat-only models (no tool calling): open weights on Cortex inference, and models Cortex serves
// only through SQL AI_COMPLETE (core-sql: no streaming, answer arrives whole).
const textOnly = { tools: false, thinking: "none", effort: false, eagerInput: false, vision: false } as const;

/** Picker order is the order below; hidden entries never appear in it. */
export const MODELS: ModelSpec[] = [
  claude("claude-opus-5-5", "Claude Opus 5.5"),
  claude("claude-opus-5", "Claude Opus 5"),
  claude("claude-opus-4-8", "Claude Opus 4.8"),
  claude("claude-opus-4-7", "Claude Opus 4.7"),
  claude("claude-opus-4-6", "Claude Opus 4.6"),
  claude("claude-opus-4-5", "Claude Opus 4.5", { thinking: "budget", effort: false, eagerInput: false }),
  claude("claude-sonnet-5-5", "Claude Sonnet 5.5"),
  claude("claude-sonnet-5", "Claude Sonnet 5"),
  claude("claude-sonnet-4-6", "Claude Sonnet 4.6"),
  claude("claude-sonnet-4-5", "Claude Sonnet 4.5", { thinking: "budget", effort: false, eagerInput: false }),
  claude("claude-haiku-5-5", "Claude Haiku 5.5"),
  chat("openai-gpt-5.5", "OpenAI GPT 5.5"),
  chat("openai-gpt-5.4", "OpenAI GPT 5.4"),
  chat("openai-gpt-5.2", "OpenAI GPT 5.2"),
  chat("openai-gpt-5", "OpenAI GPT 5"),
  { id: "r/gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "relay", group: "Gemini", tools: true, thinking: "none", effort: false, eagerInput: false, vision: true, variants: { low: "r/gemini-3.8-flash-low", medium: "r/gemini-3.8-flash-medium", high: "r/gemini-3.8-flash-high" } },
  // Gemini 4 Argon, 3.7 Flash and Llama 3.3 run on Cortex only through SQL AI_COMPLETE: chat-only, replies arrive whole.
  { id: "gemini-4-argon", label: "Gemini 4 Argon", provider: "core-sql", group: "Core", ...textOnly },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", provider: "core-sql", group: "Core", ...textOnly },
  { id: "r/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "relay", group: "Gemini", tools: true, thinking: "none", effort: false, eagerInput: false, vision: true },
  chat("grok-4.7", "Grok 4.7"),
  chat("grok-4.6", "Grok 4.6"),
  chat("kimi-k3", "Kimi K3", { thinking: "reasoning-content" }),
  chat("glm-5.3", "GLM 5.3", { thinking: "reasoning-content", vision: false }),
  { id: "llama3.3-70b", label: "Llama 3.3 70B", provider: "core-sql", group: "Core", ...textOnly },
  { id: "llama3.1-70b", label: "Llama 3.1 70B", provider: "core-inference", group: "Core", ...textOnly },
  { id: "llama3.1-8b", label: "Llama 3.1 8B", provider: "core-inference", group: "Core", ...textOnly },
  { id: "mistral-7b", label: "Mistral 7B", provider: "core-inference", group: "Core", ...textOnly },
  { id: "ultramarine-1-flash", label: "Ultramarine 1.0 Flash", provider: "fast", group: "Fast", tools: true, thinking: "reasoning-content", effort: false, eagerInput: false, vision: false },
  // Second route to Claude, used when the primary route is down (self-healing failover).
  { id: "r/claude-opus-4-6-thinking", label: "Claude Opus 4.6 · backup route", provider: "relay", group: "Relay", tools: true, thinking: "adaptive", effort: true, eagerInput: true, vision: true, hidden: true },
  { id: "r/claude-sonnet-4-6", label: "Claude Sonnet 4.6 · backup route", provider: "relay", group: "Relay", tools: true, thinking: "adaptive", effort: true, eagerInput: true, vision: true, hidden: true },
  { id: "research-agent", label: "Curialy Research Agent", provider: "research", group: "Research", ...textOnly, hidden: true },
];

export const PICKER_MODELS = MODELS.filter(model => !model.hidden);

/** Ids that older tasks and saved preferences may still carry: entry plus the thinking level it implied. */
const ALIASES: Record<string, { id: string; effort?: ThinkingLevel }> = {
  "r/gemini-3.8-flash-high": { id: "r/gemini-3.8-flash", effort: "high" },
  "r/gemini-3.8-flash-medium": { id: "r/gemini-3.8-flash", effort: "medium" },
  "r/gemini-3.8-flash-low": { id: "r/gemini-3.8-flash", effort: "low" },
  // Briefly routed through SQL; back on the relay.
  "gemini-3.8-flash": { id: "r/gemini-3.8-flash" },
  "gemini-2.5-flash": { id: "r/gemini-2.5-flash" },
};

/** Retired picker entries and the listed model that replaces them (for new tasks and saved picks). */
export const REPLACED: Record<string, string> = {
  "r/claude-sonnet-4-6": "claude-sonnet-4-6",
  "r/claude-opus-4-6-thinking": "claude-opus-4-6",
};

export function getModel(id: string) {
  return MODELS.find(model => model.id === id) ?? (ALIASES[id] ? MODELS.find(model => model.id === ALIASES[id].id) : undefined);
}

/** The thinking level an old aliased id implied (its variant), if any. */
export function aliasEffort(id: string): ThinkingLevel | undefined {
  return ALIASES[id]?.effort;
}

/** Dev Team members share one conversation format (Anthropic Messages): Claude on either route, or Gemini. */
export function teamCapable(spec: ModelSpec | undefined) {
  return Boolean(spec && spec.tools && (spec.provider === "core" || spec.provider === "relay"));
}

/** The model id sent to the API for this thinking level. */
export function wireModel(spec: ModelSpec, effort: ThinkingLevel) {
  return spec.variants?.[effort] ?? spec.id;
}

/** Whether the thinking-level control changes anything for this model. */
export function effortApplies(spec: ModelSpec) {
  return spec.effort || spec.thinking === "budget" || Boolean(spec.variants);
}

export const PHASES = [
  { id: "planning", label: "Planning & Analysis", detail: "Objective breakdown & dependency mapping" },
  { id: "deliberation", label: "Deliberation", detail: "Adaptive reasoning" },
  { id: "implementation", label: "Implementation", detail: "File edits & code synthesis" },
  { id: "verification", label: "Verification & Self-Healing", detail: "Typecheck, lint, tests" },
  { id: "review", label: "Final Review & Delivery", detail: "Synthesis & artifacts" },
] as const;

export type PhaseId = (typeof PHASES)[number]["id"];
export type PhaseState = "pending" | "active" | "done" | "failed" | "skipped";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type PlanStep = { title: string; status: "pending" | "in_progress" | "done" };

export type FileChangeKind = "create" | "modify" | "delete";

/** Every event the runtime emits. Persisted with a per-task sequence number and replayed over SSE. */
export type AgentEventBody =
  | { type: "status"; status: TaskStatus }
  | { type: "team_agent"; role: TeamRole; status: "waiting" | "working" | "done" | "failed"; model: string; activity: string }
  | { type: "handoff"; from: TeamRole; to: TeamRole | "user"; kind: "plan" | "review" | "fixes" | "report"; title: string; content: string; round?: number }
  | { type: "user_message"; text: string; attachments?: { mediaId: string; filename: string; mimeType: string; sizeBytes: number; path: string }[] }
  | { type: "phase"; phase: PhaseId; state: PhaseState; note?: string }
  /** provider is an engine alias (core | relay | fast | research), never a vendor name. */
  | { type: "dispatch"; model: string; provider: string; reason: string }
  | { type: "turn_start"; turn: number; model: string }
  | { type: "thinking_start"; blockId: string }
  | { type: "thinking_delta"; blockId: string; text: string }
  | { type: "thinking_end"; blockId: string; ms: number }
  | { type: "text_start"; blockId: string }
  | { type: "text_delta"; blockId: string; text: string }
  | { type: "text_end"; blockId: string }
  | { type: "tool_start"; callId: string; name: string }
  | { type: "tool_input_delta"; callId: string; partial: string }
  | { type: "tool_call"; callId: string; name: string; input: Record<string, unknown> }
  | { type: "tool_output"; callId: string; stream: "stdout" | "stderr"; chunk: string }
  | { type: "tool_result"; callId: string; ok: boolean; summary: string; exitCode?: number | null; durationMs: number }
  | { type: "file_change"; callId: string; path: string; kind: FileChangeKind; before: string; after: string; bytesBefore: number; bytesAfter: number; added: number; removed: number; truncated: boolean }
  | { type: "plan"; steps: PlanStep[] }
  | { type: "verify_start"; iteration: number; commands: string[] }
  | { type: "verify_result"; iteration: number; command: string; ok: boolean; exitCode: number | null; output: string; durationMs: number }
  | { type: "heal"; iteration: number; reason: string; model: string }
  /** Self-healing around a model turn: what failed and what was done about it. */
  | { type: "recovery"; kind: string; action: string; detail: string; attempt: number; delayMs?: number; model?: string }
  | { type: "usage"; turn: number; model: string; inputTokens: number; outputTokens: number; thinkingTokens: number; cacheReadTokens: number }
  | { type: "external"; source: "research" | "research"; status: string; detail: string; url?: string }
  | { type: "media"; callId: string; mediaId: string | null; filename: string; mimeType: string; caption: string; inlineDataUrl?: string }
  | { type: "deployment"; deploymentId: string; status: "creating" | "building" | "live" | "failed" | "deleted"; url?: string; detail: string; expiresAt?: string }
  /** Files attached to the chat (stored in Curialy Vault). auto = collected at the end of the run. */
  | { type: "artifacts"; files: { mediaId: string; path: string; filename: string; mimeType: string; sizeBytes: number; kind: "image" | "pdf" | "archive" | "document" | "code" | "data" | "other"; primary: boolean }[]; auto: boolean; more: number; skipped: string[] }
  | { type: "browser_session"; sessionId: string; status: "live" | "ended"; liveUrl: string | null; replayUrl: string; reason?: string }
  | { type: "browser_action"; sessionId: string; action: string; detail: string; url: string; title: string }
  | { type: "preview"; url: string; dir: string | null; mode: "static" | "server" }
  | { type: "repo"; fullName: string; branch: string; baseSha: string; repoPath: string; url: string }
  | { type: "repo_push"; fullName: string; branch: string; commitSha: string; commitUrl: string; changed: number; deleted: number }
  | { type: "repo_pr"; fullName: string; number: number; url: string; head: string; base: string }
  | { type: "notice"; level: "info" | "warn"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; status: TaskStatus; answer: string };

/** agent: which Dev Team member produced the event (absent for solo runs and orchestration). */
export type AgentEvent = AgentEventBody & { seq: number; ts: string; agent?: TeamRole };

export type AgentTaskSummary = {
  id: string;
  prompt: string;
  status: TaskStatus;
  mode: TaskMode;
  model: string;
  effort: ThinkingLevel;
  webSearch: boolean;
  phase: PhaseId | null;
  answer?: string;
  error?: string;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number };
  filesChanged: number;
  githubRepo?: string;
  githubRepoUrl?: string;
  githubPushedAt?: string;
  githubMode?: "export" | "linked";
  team?: boolean;
  githubBranch?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateTaskRequest = {
  prompt: string;
  model: string; // "auto" or a MODELS id
  mode: TaskMode;
  effort: ThinkingLevel;
  webSearch: boolean;
  attachmentIds: string[];
  /** Optional "owner/name" to clone into the workspace before the agent starts. */
  repo?: string | null;
  repoBranch?: string | null;
  /** Dev Team mode: Architect → Engineer → Reviewer with review rounds. Agent mode only. */
  team?: boolean;
};
