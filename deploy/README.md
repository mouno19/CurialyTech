# Running Curialy AI in production

How curialy.tech runs today, and how to rebuild the same host from scratch. No secrets are in
this repository: the two env files are templates (`deploy/env/*.example`); the real ones live
only on the server, owned by root with mode 600.

## The host

| Piece | Where | Notes |
|---|---|---|
| App | `curialyai.service` ([unit](systemd/curialyai.service)) | `node dist/index.js` on `127.0.0.1:3000`, user `ubuntu`, `MemoryMax=400M`, env `/etc/curialyai.env`. |
| Model bridge | `snowflake-proxy.service` ([unit](systemd/snowflake-proxy.service), [source](snowflake-proxy/proxy.js)) | `127.0.0.1:8082`. The only holder of the Snowflake PAT for Cortex REST (env `/etc/snowflake-proxy.env`). Installed at `~/snowflake-proxy/proxy.js`. |
| Web | nginx ([site](nginx/curialyai.conf)) | TLS by certbot, proxies everything (including SSE) to :3000. |
| Sandbox | user `curialy-agent`, `/srv/curialy-workspaces`, iptables chain `CURIALY_SANDBOX` | Set up by [setup-sandbox.sh](sandbox/setup-sandbox.sh). |
| Data | Tiger Cloud Postgres, schema `curialy` | Tasks, events, conversations, team state, workspace snapshots, file metadata, GitHub connection (token AES-256-GCM encrypted). Migrations run at start-up (`server/db/pg.ts`). |
| Media | Snowflake stage `@CURIALY_DB.PUBLIC.USER_MEDIA_STAGE` | Uploads, screenshots and artifacts; served through the app with presigned URLs. See [setup.sql](snowflake/setup.sql). |

The VPS keeps no user data: workspaces are scratch, snapshotted to Tiger and swept after
`AGENT_WORKSPACE_IDLE_MINUTES`; media bytes go from memory straight to the stage.

## How a task runs

1. The composer posts `/api/agent/tasks` (model or Auto, mode, thinking level, Web, Dev Team, attachments, repo).
2. `server/agent/runner.ts` picks the model (`dispatchModel`), materializes the workspace, and runs the loop for that model's format, streaming every event (thinking, text, tool calls, terminal output, diffs, phases) through `server/agent/bus.ts` to SSE and Tiger.
3. Tools (`server/agent/tools.ts`) run in the sandbox: files, shell, search, web fetch, live browser, visual preview tests, GitHub, deploy previews, research delegation.
4. Coding runs end with harness verification; failures loop back with the error output (self-healing, up to 4 iterations, escalating to the strongest model of the format).
5. Every model call is wrapped by `server/agent/recovery.ts`: retries with backoff, context compaction, history repairs, and failover to the closest same-format model.
6. Dev Team mode (`server/agent/team.ts`): Architect plans (read-only), Engineer builds, Reviewer reviews the diff and tests (read-only, its source edits are reverted); publishing happens only after approval.
7. Changed files are attached to the chat as artifacts; the workspace is snapshotted.

## Models and routes (`shared/agent.ts`)

| Models | Route | Capabilities |
|---|---|---|
| Claude Opus 5.5, 5, 4.8, 4.7, 4.6, 4.5; Sonnet 5.5, 5, 4.6, 4.5; Haiku 5.5 | Bridge → Cortex `/api/v2/cortex/v1/messages` | Tools, images, thinking (adaptive; budgeted on the 4.5 models), effort |
| OpenAI GPT 5.5, 5.4, 5.2, 5; Grok 4.7, 4.6; Kimi K3; GLM 5.3 | Bridge `/v1/chat/completions` → Cortex chat completions (`max_tokens` → `max_completion_tokens`) | Tools, images (not GLM), `reasoning_effort`, streamed `reasoning_content` (Kimi, GLM) |
| Gemini 3.8 Flash, Gemini 2.5 Flash | RelayStation (Anthropic Messages format) | Tools, images, streamed; 3.8 Flash variant follows the thinking level |
| Gemini 4 Argon, Gemini 3.7 Flash, Llama 3.3 70B | Snowflake SQL `AI_COMPLETE` on `COMPUTE_WH` (`server/media/snowflake.ts`) | Chat only, reply arrives whole (Cortex REST does not serve these) |
| Llama 3.1 70B, Llama 3.1 8B, Mistral 7B | Bridge `/cortex/inference` → Cortex `inference:complete` | Chat only, streamed |
| Ultramarine 1.0 Flash | Paper Instruments chat completions | Tools, streamed reasoning |

Auto routes complex or high-effort work to Opus 5.5, routine coding to Sonnet 5.5 and quick
asks to Haiku 5.5. Hidden entries (backup Claude routes on RelayStation, the Research Agent)
are used for failover and delegation only.

## Rebuilding the host from scratch

1. Ubuntu with Node 22, nginx, certbot, git. Clone this repo to `/srv/curialyai-next` (`chmod 750`), then `pnpm install` (or `npm install`).
2. Snowflake: run [snowflake/setup.sql](snowflake/setup.sql) as ACCOUNTADMIN and create a PAT for the service user.
3. Tiger Cloud: create a service and put its connection string in `TIGER_DATABASE_URL` (tables are created on first start).
4. Secrets: copy [env/curialyai.env.example](env/curialyai.env.example) to `/etc/curialyai.env` and [env/snowflake-proxy.env.example](env/snowflake-proxy.env.example) to `/etc/snowflake-proxy.env`, fill them in, then `chmod 600` both (root-owned). Set the admin password with `sudo node scripts/set-admin-password.mjs` (prompts; writes the hash and a session secret).
5. Bridge: `mkdir -p ~/snowflake-proxy && cp deploy/snowflake-proxy/proxy.js ~/snowflake-proxy/`.
6. Services: copy `deploy/systemd/*` to `/etc/systemd/system/` (including the `snowflake-proxy.service.d/` drop-in), then `sudo systemctl daemon-reload && sudo systemctl enable --now snowflake-proxy`.
7. Sandbox: `sudo deploy/sandbox/setup-sandbox.sh`.
8. Build and start: `deploy/deploy.sh` (or `npm run build && sudo systemctl enable --now curialyai`).
9. Web: install [nginx/curialyai.conf](nginx/curialyai.conf) as a site and run `certbot --nginx -d curialy.tech -d www.curialy.tech`.
10. GitHub OAuth app: callback `https://curialy.tech/api/auth/callback/github`, scopes `read:user user:email repo`.

## Day-to-day

- Deploy: `deploy/deploy.sh` (typecheck, tests, build with the previous build kept as `dist-prev/`, restart, health check). Add `--bridge` when `deploy/snowflake-proxy/proxy.js` changed.
- Roll back: `deploy/deploy.sh --rollback`.
- Logs: `journalctl -u curialyai -f`, `journalctl -u snowflake-proxy -f`.
- Health: the Integrations page ("Run live model check") probes every route end to end.
- Memory: the box has about 1 GB of RAM. Stop any side instance (`sudo systemctl stop curialy-test`) before building.
- Bridge restarts: delay them (`systemd-run --on-active=4 ...`, as deploy.sh does) when something else is talking through the bridge.
