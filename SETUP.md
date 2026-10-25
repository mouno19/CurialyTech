# Curialy AI: architecture and development

React 19 + Vite client, Express + tRPC server bundled with esbuild, Tiger Cloud Postgres for
all state, a Snowflake stage for media. Production layout and operations are in
[deploy/README.md](deploy/README.md).

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Model catalog | `shared/agent.ts` | The 28 picker models, their provider, format and capabilities; aliases for retired ids. |
| Dispatch and loops | `server/agent/runner.ts` | Auto routing, Anthropic-format tool loop (Claude, Gemini via relay), OpenAI-format loop (GPT, Grok, Kimi, GLM, Ultramarine), chat-only runner (inference and SQL `AI_COMPLETE`), harness verification and self-healing, escalation. |
| Providers | `server/agent/providers.ts` | Bridge clients for Cortex Messages / chat completions / inference, RelayStation, Paper Instruments, Research Agent, health probes. |
| SQL completion and media | `server/media/snowflake.ts` | `AI_COMPLETE` (bound parameters, cancellable), stage uploads, presigned URLs. |
| Recovery | `server/agent/recovery.ts` | Failure diagnosis, backoff, context compaction, history repairs, same-format failover tiers. |
| Dev Team | `server/agent/team.ts` | Architect / Engineer / Reviewer with read-only enforcement, review rounds and gated publishing. |
| Tools | `server/agent/tools.ts` | Plan, files, shell, search, web fetch, live browser, visual preview tests, attachments, GitHub, deploy previews, research. |
| Sandbox | `server/agent/sandbox.ts` | Per-task workspaces; commands run as `curialy-agent` in a transient systemd scope (512 MB, 150% CPU, 256 tasks) via `setpriv`; path checks through `realpath`/`O_NOFOLLOW`. |
| Events | `server/agent/bus.ts`, `store.ts` | Per-task sequenced events, coalesced deltas, batched writes to Tiger, SSE replay at `/api/agent/tasks/:id/events`. |
| Workspaces | `server/agent/workspaces.ts` | Snapshots to Tiger, restore on follow-up, idle sweep. |
| Artifacts and attachments | `server/agent/artifacts.ts`, `attachments.ts` | Files produced by a run attached to the chat; uploads staged into the workspace; images sent to vision models. |
| GitHub | `server/services/github.ts`, `server/auth-github.ts`, `server/agent/repos.ts` | OAuth (token encrypted at rest), clone into an app-owned staging dir, push via the REST API; the token never enters the sandbox. |
| Previews | `server/agent/preview.ts`, `browser.ts`, `deploy.ts` | Signed sandboxed preview route, cloud browser sessions, temporary cloud deploys. |
| White-label | `shared/brand.ts` | User-facing text never names vendors; `brandText()` scrubs platform messages. |
| Auth | `server/auth.ts` | Single operator: scrypt password hash, signed session cookie, login rate limit, same-origin checks. |
| UI | `client/src/pages/TaskWorkspace.tsx`, `components/deck/*`, `components/composer/*` | Conversation and output; phase timeline, thinking, terminal, diffs, live browser, team panel. |

## Local development

1. `pnpm install`
2. Create `.env` from [deploy/env/curialyai.env.example](deploy/env/curialyai.env.example) (at minimum `TIGER_DATABASE_URL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`), set `AGENT_SANDBOX=none` and `AGENT_WORKSPACE_ROOT` to a local folder, and point `CORTEX_BRIDGE_URL` at a running bridge (`deploy/snowflake-proxy/proxy.js` with `SNOWFLAKE_PAT`).
3. `pnpm dev`

Tests mock the model providers and use a temporary workspace with the sandbox off: `pnpm test`.
