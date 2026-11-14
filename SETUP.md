# Curialy AI: architecture and development

React 19 + Vite client, Express + tRPC server bundled with esbuild, Tiger Cloud Postgres for
all state, a Snowflake stage for media. Production layout and operations are in
[deploy/README.md](deploy/README.md).

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Model catalog | `shared/agent.ts` | The 28 picker models, their provider, format and capabilities; aliases for retired ids. |
| Dispatch and loops | `server/agent/runner.ts` | Auto routing, Anthropic-format tool loop (Claude, Gemini via relay), OpenAI-format loop (GPT, Grok, Kimi, GLM, Ultramarine), chat-only runner (inference and SQL `AI_COMPLETE`), harness verification and self-healing (3 rounds), escalation. Verification counts changes made by commands too, falls back to the build or to syntax checks of the changed files when a project has no checks, and skips a check the agent passed after its last change. `write_file` won't replace a file that was there before the run until the agent has read it. |
| Providers | `server/agent/providers.ts` | Bridge clients for Cortex Messages / chat completions / inference, RelayStation, Paper Instruments, Research Agent, health probes. |
| SQL completion and media | `server/media/snowflake.ts` | `AI_COMPLETE` (bound parameters, cancellable), stage uploads, presigned URLs. |
| Recovery | `server/agent/recovery.ts` | Failure diagnosis, backoff, context compaction, history repairs, same-format failover tiers. |
| Dev Team | `server/agent/team.ts` | Architect / Engineer / Reviewer with read-only enforcement, review rounds and gated publishing. |
| Tools | `server/agent/tools.ts` | Plan, files, shell, search, web fetch, live browser, visual preview tests, attachments, GitHub, deploy previews, research. |
| Background commands | `server/agent/jobs.ts` | Installs, builds and dev servers that run past a few seconds go on in the background (token `bg-…`), streaming into their tool card; `command_status` / `stop_command`; completion notes on the agent's next tool result. At most 3 per run; servers stop when the agent finishes its turn, the rest get 5 minutes; all stop when the run ends. Cloud sandbox only (commands here run one at a time). |
| Command output | `server/agent/output.ts` | What the model reads of a command: colours and progress redraws stripped, repeats folded, and long logs cut to the first 10 lines, the error lines and the last 30 (file contents, diffs and searches kept whole up to 16 KB). The run log keeps every line. |
| Sandbox | `server/agent/sandbox.ts` | Per-task workspaces; commands run as `curialy-agent` in a transient systemd scope (512 MB, 150% CPU, 256 tasks) via `setpriv`; path checks through `realpath`/`O_NOFOLLOW`. |
| Events | `server/agent/bus.ts`, `store.ts` | Per-task sequenced events, coalesced deltas, batched writes to Tiger, SSE replay at `/api/agent/tasks/:id/events`. |
| Workspaces | `server/agent/workspaces.ts` | Snapshots to Tiger, restore on follow-up, idle sweep. |
| Artifacts and attachments | `server/agent/artifacts.ts`, `attachments.ts` | Files produced by a run attached to the chat; uploads staged into the workspace; images sent to vision models. |
| GitHub | `server/services/github.ts`, `server/auth-github.ts`, `server/agent/repos.ts` | OAuth (token encrypted at rest), clone into an app-owned staging dir, push via the REST API; the token never enters the sandbox. |
| GitHub Actions | `server/agent/github-ci-tools.ts` | Commits, build statuses, workflows, runs, jobs and logs (digest, or a job's complete log page by page) through the REST API with the task owner's token; no gh CLI in the sandbox (the token never enters it). Starting, rerunning and cancelling workflows wait for approval. |
| Approvals | `server/agent/requests.ts`, `client/src/components/task/RequestPanel.tsx` | Every change the agent makes on GitHub (push, pull request, workflow start/rerun/cancel) shows exactly what changes and waits up to 15 minutes for Approve / Approve all in this task / Deny, unless the account turned asking off (`users.github_auto_approve`, the GitHub menu). |
| Secrets | `server/secrets.ts`, `server/agent/requests.ts`, `server/agent/redact.ts`, `client/src/pages/Secrets.tsx` | request_secret: a saved secret, else a masked box in the chat. Values live in memory for the task (an hour after last use), reach every command as environment variables (cloud sandbox: per-command envs; local: stdin, never arguments), and are wiped from command output (streamed too), every event and every tool result. Saved secrets (Secrets page) are AES-256-GCM encrypted with TOKEN_ENCRYPTION_KEY; values are never returned. A push refuses files that contain one. |
| Canva | `server/services/canva.ts`, `server/auth-canva.ts`, `server/agent/canva-tools.ts` | Connect API per account (PKCE S256, state bound to the account, Basic client auth). Only the refresh token is stored, AES-256-GCM encrypted; it rotates on every refresh, under the row's lock. Tools behind a `CanvaBackend` interface (REST now; Canva's MCP server can be added): list/search designs, get a design, list folders, create a design after the user approves its exact title, type and size. |
| Vercel | `server/services/vercel.ts`, `server/auth-vercel.ts`, `server/agent/vercel-tools.ts` | Sign in with Vercel per account (PKCE, state bound to the account, nonce in the ID token). Only the refresh token is stored, AES-256-GCM encrypted; it rotates on every refresh, under the row's lock. Read-only agent tools: projects, deployments, deployment status, build logs. |
| Previews | `server/agent/preview.ts`, `browser.ts`, `deploy.ts` | Signed sandboxed preview route, cloud browser sessions, temporary cloud deploys. |
| White-label | `shared/brand.ts` | User-facing text never names vendors; `brandText()` scrubs platform messages. |
| Auth | `server/auth.ts` | Single operator: scrypt password hash, signed session cookie, login rate limit, same-origin checks. |
| UI | `client/src/pages/TaskWorkspace.tsx`, `components/deck/*`, `components/composer/*` | Conversation and output; phase timeline, thinking, terminal, diffs, live browser, team panel. |

## Local development

1. `pnpm install`
2. Create `.env` from [deploy/env/curialyai.env.example](deploy/env/curialyai.env.example) (at minimum `TIGER_DATABASE_URL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`), set `AGENT_SANDBOX=none` and `AGENT_WORKSPACE_ROOT` to a local folder, and point `CORTEX_BRIDGE_URL` at a running bridge (`deploy/snowflake-proxy/proxy.js` with `SNOWFLAKE_PAT`).
3. `pnpm dev`

Tests mock the model providers and use a temporary workspace with the sandbox off: `pnpm test`.
