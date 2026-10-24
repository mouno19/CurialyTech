// Shared contract between the agent runtime (server/agent) and the glassbox UI.

export type ProviderId = "core" | "core-inference" | "relay" | "fast" | "research";
/** Engine family, used for colour coding only (white-label: never shown as a vendor name). */
export type ModelGroup = "Core" | "Relay" | "Fast" | "Research" | "Gemini";
/** How the model picker organizes models: by what they are good at. */
export type Capability = "Flagship Heavy Coding" | "Ultra-Fast Reasoning" | "Speed & High Context" | "Open Weights" | "Autonomous Web";
export type ThinkingLevel = "low" | "medium" | "high";
export type TaskMode = "agent" | "chat";

export type ModelSpec = {
  id: string;
  label: string;
  provider: ProviderId;
  group: ModelGroup;
  capability: Capability;
  description: string;
  /** Accepts client tools (required for agent mode). */
  tools: boolean;
  /** How thinking is requested/streamed: Anthropic adaptive (+summarized display), OpenAI-style reasoning_content, or none. */
  thinking: "adaptive-summarized" | "adaptive" | "reasoning-content" | "none";
  /** Accepts output_config.effort (or reasoning_effort for OpenAI-format providers). */
  effort: boolean;
  /** Accepts eager_input_streaming on tools (Sonnet 4.5 on Cortex rejects the field outright). */
  eagerInput: boolean;
  /** Accepts image blocks in tool results (Browserbase screenshots). */
  vision: boolean;
};

export const MODELS: ModelSpec[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "core", group: "Core", capability: "Flagship Heavy Coding", description: "Flagship adaptive reasoning. Architecture, debugging, self-healing escalations.", tools: true, thinking: "adaptive-summarized", effort: true, eagerInput: true, vision: true },
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "core", group: "Core", capability: "Flagship Heavy Coding", description: "Deep analytical reasoning.", tools: true, thinking: "adaptive-summarized", effort: true, eagerInput: true, vision: true },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "core", group: "Core", capability: "Flagship Heavy Coding", description: "Complex systems architecture.", tools: true, thinking: "adaptive", effort: true, eagerInput: true, vision: true },
  { id: "r/claude-opus-4-6-thinking", label: "Claude Opus 4.6 Thinking", provider: "relay", group: "Relay", capability: "Flagship Heavy Coding", description: "Opus 4.6 with extended thinking.", tools: true, thinking: "adaptive", effort: true, eagerInput: true, vision: true },
  { id: "ultramarine-1-flash", label: "Ultramarine 1.0 Flash", provider: "fast", group: "Fast", capability: "Ultra-Fast Reasoning", description: "Fast reasoning with streamed chain-of-thought (reasoning_content).", tools: true, thinking: "reasoning-content", effort: false, eagerInput: false, vision: false },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "core", group: "Core", capability: "Ultra-Fast Reasoning", description: "Fast code generation and tool calling.", tools: true, thinking: "none", effort: false, eagerInput: false, vision: true },
  { id: "r/claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "relay", group: "Relay", capability: "Ultra-Fast Reasoning", description: "Fast edits and routine coding.", tools: true, thinking: "adaptive", effort: true, eagerInput: true, vision: true },
  { id: "r/gemini-3.8-flash-high", label: "Gemini 3.8 Flash (high)", provider: "relay", group: "Gemini", capability: "Speed & High Context", description: "Speed and very large context.", tools: true, thinking: "none", effort: false, eagerInput: false, vision: true },
  { id: "r/gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (medium)", provider: "relay", group: "Gemini", capability: "Speed & High Context", description: "Balanced Gemini 3.8 Flash.", tools: true, thinking: "none", effort: false, eagerInput: false, vision: true },
  { id: "r/gemini-3.8-flash-low", label: "Gemini 3.8 Flash (low)", provider: "relay", group: "Gemini", capability: "Speed & High Context", description: "Lowest-latency Gemini 3.8 Flash.", tools: true, thinking: "none", effort: false, eagerInput: false, vision: true },
  { id: "r/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "relay", group: "Gemini", capability: "Speed & High Context", description: "Proven, fast general model.", tools: true, thinking: "none", effort: false, eagerInput: false, vision: true },
  { id: "llama3.1-70b", label: "Llama 3.1 70B", provider: "core-inference", group: "Core", capability: "Open Weights", description: "Open-weight model. Chat only (no tools).", tools: false, thinking: "none", effort: false, eagerInput: false, vision: false },
  { id: "llama3.1-8b", label: "Llama 3.1 8B", provider: "core-inference", group: "Core", capability: "Open Weights", description: "High-throughput utility. Chat only.", tools: false, thinking: "none", effort: false, eagerInput: false, vision: false },
  { id: "mistral-7b", label: "Mistral 7B", provider: "core-inference", group: "Core", capability: "Open Weights", description: "High-throughput utility. Chat only.", tools: false, thinking: "none", effort: false, eagerInput: false, vision: false },
  { id: "research-agent", label: "Curialy Research Agent", provider: "research", group: "Research", capability: "Autonomous Web", description: "Autonomous web research and browser workflows (runs for minutes).", tools: false, thinking: "none", effort: false, eagerInput: false, vision: false },
];

export const MODEL_GROUPS: ModelGroup[] = ["Core", "Fast", "Relay", "Gemini", "Research"];
export const CAPABILITIES: Capability[] = ["Flagship Heavy Coding", "Ultra-Fast Reasoning", "Speed & High Context", "Open Weights", "Autonomous Web"];

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
  githubRepo?: string;
  githubRepoUrl?: string;
  githubPushedAt?: string;
  githubMode?: "export" | "linked";
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
};
