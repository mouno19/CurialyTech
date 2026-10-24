// Shared contract between the agent runtime (server/agent) and the glassbox UI.

export type ProviderId = "cortex" | "cortex-inference" | "relay" | "manus";
export type ModelGroup = "Snowflake Cortex" | "RelayStation" | "Manus" | "Google Gemini";
export type ThinkingLevel = "low" | "medium" | "high";
export type TaskMode = "agent" | "chat";

export type ModelSpec = {
  id: string;
  label: string;
  provider: ProviderId;
  group: ModelGroup;
  description: string;
  /** Accepts client tools (required for agent mode). */
  tools: boolean;
  /** How thinking is requested: adaptive+summarized display, adaptive only, or not at all. */
  thinking: "adaptive-summarized" | "adaptive" | "none";
  /** Accepts output_config.effort. */
  effort: boolean;
  /** Accepts eager_input_streaming on tools (Sonnet 4.5 on Cortex rejects the field outright). */
  eagerInput: boolean;
};

export const MODELS: ModelSpec[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "cortex", group: "Snowflake Cortex", description: "Flagship adaptive reasoning. Architecture, debugging, self-healing escalations.", tools: true, thinking: "adaptive-summarized", effort: true, eagerInput: true },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "cortex", group: "Snowflake Cortex", description: "Deep analytical reasoning.", tools: true, thinking: "adaptive-summarized", effort: true, eagerInput: true },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "cortex", group: "Snowflake Cortex", description: "Complex systems architecture.", tools: true, thinking: "adaptive", effort: true, eagerInput: true },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "cortex", group: "Snowflake Cortex", description: "Fast code generation and tool calling.", tools: true, thinking: "none", effort: false, eagerInput: false },
  { id: "llama3.1-70b", label: "Llama 3.1 70B", provider: "cortex-inference", group: "Snowflake Cortex", description: "Open weights. Chat only (no tools).", tools: false, thinking: "none", effort: false, eagerInput: false },
  { id: "llama3.1-8b", label: "Llama 3.1 8B", provider: "cortex-inference", group: "Snowflake Cortex", description: "High-throughput utility. Chat only.", tools: false, thinking: "none", effort: false, eagerInput: false },
  { id: "mistral-7b", label: "Mistral 7B", provider: "cortex-inference", group: "Snowflake Cortex", description: "High-throughput utility. Chat only.", tools: false, thinking: "none", effort: false, eagerInput: false },
  { id: "r/claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "relay", group: "RelayStation", description: "Fast edits and routine coding via RelayStation.", tools: true, thinking: "adaptive", effort: true, eagerInput: true },
  { id: "r/claude-opus-4-6-thinking", label: "Claude Opus 4.6 Thinking", provider: "relay", group: "RelayStation", description: "Opus 4.6 with thinking via RelayStation.", tools: true, thinking: "adaptive", effort: true, eagerInput: true },
  { id: "r/gemini-3.7-flash-high", label: "Gemini 3.7 Flash", provider: "relay", group: "Google Gemini", description: "Google Gemini, routed through RelayStation.", tools: true, thinking: "none", effort: false, eagerInput: false },
  { id: "manus-agent", label: "Manus Agent", provider: "manus", group: "Manus", description: "External web research and browser sandbox. Runs remotely on Manus.", tools: false, thinking: "none", effort: false, eagerInput: false },
];

export const MODEL_GROUPS: ModelGroup[] = ["Snowflake Cortex", "RelayStation", "Manus", "Google Gemini"];

export function getModel(id: string) {
  return MODELS.find(model => model.id === id);
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
  | { type: "user_message"; text: string }
  | { type: "phase"; phase: PhaseId; state: PhaseState; note?: string }
  | { type: "dispatch"; model: string; provider: ProviderId; reason: string }
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
  | { type: "usage"; turn: number; model: string; inputTokens: number; outputTokens: number; thinkingTokens: number; cacheReadTokens: number }
  | { type: "external"; source: "manus"; status: string; detail: string; url?: string }
  | { type: "notice"; level: "info" | "warn"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; status: TaskStatus; answer: string };

export type AgentEvent = AgentEventBody & { seq: number; ts: string };

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
};
