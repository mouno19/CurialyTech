# Running Curialy AI in production

How curialy.tech runs today, and how to rebuild the same host from scratch. No secrets are in
this repository: the two env files are templates (`deploy/env/*.example`); the real ones live
only on the server, owned by root with mode 600.

## The host

| Piece | Where | Notes |
|---|---|---|
| App | `curialyai.service` ([unit](systemd/curialyai.service)) | `node dist/index.js` on `127.0.0.1:3000`, user `ubuntu`, `MemoryMax=400M`, env `/etc/curialyai.env`. |
| Model bridge | `snowflake-proxy.service` ([unit](systemd/snowflake-proxy.service), [source](snowflake-proxy/proxy.js)) | `127.0.0.1:8082`. The only holder of the Snowflake PATs for Cortex REST: a pool of accounts in `~/snowflake-proxy/pool.json` (shape: [pool.example.json](snowflake-proxy/pool.example.json); never committed), else `/etc/snowflake-proxy.env`. On a 401/403 it moves to the next account and retries the request. Installed at `~/snowflake-proxy/proxy.js`. |
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
4. Coding runs end with harness verification; failures loop back with the error output (self-healing, up to 4 iterations, escalating to the strongest model of the format). The same check failing the same way twice ends self-healing, and the run is delivered with the failure reported. In the last fifth of its turns (60 for a solo run or an Engineer pass, 30 for the Architect and each review round) an agent is told to wrap up; one that reaches the limit ends with a summary of the work as it stands ("Stopped at the turn limit"), not a failed run. A review round without a verdict ends the review.
5. Every model call is wrapped by `server/agent/recovery.ts`: retries with backoff, context compaction, history repairs, and failover to the closest same-format model (on another route when the current one refuses every request; a switch around an outage lasts for that run only, and a free account's run never moves to a model that costs more credits).
6. Dev Team mode (`server/agent/team.ts`): Architect plans (read-only), Engineer builds, Reviewer reviews the diff and tests (read-only, its source edits are reverted); publishing happens only after approval.
7. Changed files are attached to the chat as artifacts (generated build output is summarised, not attached); the workspace is snapshotted, with the built site kept separately so an archived preview stays known.

## Task lifecycle and restarts (`server/agent/lifecycle.ts`)

- Status is one of queued, running, cancelling, completed, failed, cancelled, interrupted (`shared/taskStatus.ts` has the transition table). Every status change is a conditional update fenced by the run's `run_id`; terminal changes insert the run's last `status`/`done` events in the same statement, so the task row and the replayed event log always agree.
- The worker that claims a run records `worker_id` and renews a 45 s lease every 15 s. On boot and every 30 s, runs whose worker is gone (dead pid on this host, expired lease elsewhere, or rows from pre-lease code) become **interrupted**, with their open browser sessions closed in the log. Nothing is retried automatically; the task page offers Retry.
- SIGTERM (systemctl restart) refuses new runs, stops running ones as interrupted within about 15 s and exits. Install the unit from `deploy/systemd/` (`KillMode=mixed`, `TimeoutStopSec=30`) so the app gets the signal first.
- Cancel is idempotent and only stops the run. Publishing (pushes, pull requests, deploys) is never started by a cancel; a deploy or push in flight is stopped before its next external write, and a cancel deadline waits for a publishing step to finish so it is recorded.
- Deploy previews start from the confirmed Deploy action or, on the operator's tasks, from the operator's own message asking for one (that run only, with one more attempt after a failed one; a retry of the run deploys only if no preview went live). They always build from a new temporary **private** repository; they never write to a repository you linked or exported. Cancelled, failed and expired previews are taken down and the reason is logged on the task.
- A second instance sharing the database (e.g. a side test instance) must set `AGENT_INSTANCE_ROLE=replica` and run the same code version as production: replicas never reclaim rows written by older code and do not run the sweepers. Better still, give it its own database (a Tiger fork).

## Media storage

- Requests for stored files never return 500: unknown 404, gone 410, storage unavailable 503 with `Retry-After`. A circuit breaker keeps an outage to one probe at a time instead of a warehouse query per thumbnail.
- `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_ROLE` and `SNOWFLAKE_PAT` have no defaults. If the stage is missing in the configured account (as after the 2026-10-26 account switch), run part 2 of [snowflake/setup.sql](snowflake/setup.sql) as ACCOUNTADMIN with the role and user set to the env values.
- Files stored in a previous account's stage are not in the new one; they show as no longer available (artifacts fall back to the archived workspace copy when it matches).

## Models and routes (`shared/agent.ts`)

| Models | Route | Capabilities |
|---|---|---|
| Claude Opus 5.5, 5, 4.8, 4.7, 4.6, 4.5; Sonnet 5.5, 5, 4.6, 4.5; Haiku 5.5 | Bridge → Cortex `/api/v2/cortex/v1/messages` | Tools, images, thinking (adaptive; budgeted on the 4.5 models), effort |
| OpenAI GPT 5.5, 5.4, 5.2, 5; Grok 4.7, 4.6; Kimi K3; GLM 5.3 | Bridge `/v1/chat/completions` → Cortex chat completions (`max_tokens` → `max_completion_tokens`) | Tools, images (not GLM), `reasoning_effort`, streamed `reasoning_content` (Kimi, GLM) |
| Gemini 3.8 Flash | RelayStation (Anthropic Messages format) | Tools, images, streamed; sent as its high variant (the only one the relay serves; Gemini 2.5 Flash is gone and saved picks move to 3.8) |
| Gemini 4 Argon, Gemini 3.7 Flash, Llama 3.3 70B | Snowflake SQL `AI_COMPLETE` on `COMPUTE_WH` (`server/media/snowflake.ts`) | Chat only, reply arrives whole (Cortex REST does not serve these) |
| Llama 3.1 70B, Llama 3.1 8B, Mistral 7B | Bridge `/cortex/inference` → Cortex `inference:complete` | Chat only, streamed |
| Ultramarine 1.0 Flash | Paper Instruments chat completions | Tools, streamed reasoning |

Auto routes complex or high-effort work to Opus 5.5, routine coding to Sonnet 5.5 and quick
asks to Haiku 5.5. Hidden entries (the backup route: RelayStation's copies of Claude Opus 5.5/5, Sonnet 5.5/5/4.6, Haiku 4.5 and Opus 4.6; the Research Agent)
are used for failover and delegation only.

## Developer API (`server/gateway`, page `/developer`)

- Every account can create up to 10 active keys (`cur_live_` + 32 hex). The secret is returned once by `POST /api/keys`; the database keeps only its SHA-256 and the first 13 characters (`curialy.api_keys`, migration 9). `DELETE /api/keys/:id` revokes at once (lookups are cached 30 s, and revoking clears the entry).
- `https://curialy.tech/v1` (also `/api/v1`): `POST /messages` (Anthropic), `POST /chat/completions` (OpenAI, translated to Messages in `server/gateway/openai.ts`), `GET /models`. Keys go in `x-api-key` or `Authorization: Bearer`. Models: `shared/gateway.ts` (`claude-opus-5-5`, `claude-sonnet-4-5`), limited per key.
- Requests go to the bridge (`CORTEX_BRIDGE_URL`) and, when it refuses, to the relay's copy of the same model; after a refusal the bridge is skipped for 2 minutes.
- Nothing upstream reaches the caller. No upstream header is copied (only content type, `x-curialy-request-id` and CORS are set). Upstream 401/403/5xx become a 503 `curialy_api_error`, and only the caller's own request errors (400/413/422) pass on, scrubbed with `brandText`. Stream error events are masked too, and log lines read `[Curialy Gateway] Upstream error: core|relay …`, scrubbed the same way.
- Usage is charged to the key's account's USD API balance (`users.api_balance_micros`) at each model's list price in `shared/billing.ts` `API_PRICES`, less the API offer; the operator's account is not charged (its usage is recorded at no cost). While a request runs, the most it can cost is held. Non-operator accounts: at most 3 requests in flight, `max_tokens` up to the route's limit when streaming (16,384 without), refused with 402 `insufficient_balance` when the balance can't cover the request.
- nginx: the `location ~ ^/(api/)?v1/` block turns off response buffering and allows 10-minute reads.

## Free credits and the X rewards (`server/credits.ts`, `server/rewards.ts`, page `/billing`)

- A new account gets welcome credits once (default 60, Admin → Settings); they are bonus credits and never refill. There is no refilling allowance for everyone unless "credits per window" is set above zero. The first few accounts from one network get them; later ones from the same network start without them (`server/signup-network.ts`).
- Plans & Billing → Earn credits on X: an account links one X account, then claims following (default @Yumiko_web3, 240) and a public post of its own that names curialy.tech (default 300). Each once. Both claimed, the launch boost refills (default 300 every 8 hours) until the offer is turned off or its end passes; a plan's allowance is used instead when it is higher.
- Checks use `X_BEARER_TOKEN` (app-only) against `api.x.com`: the user by username, the post by id, and follower pages (the account's own following list only when the follower list is too long to read). The token is never logged. Migration 14 adds the columns and gives existing accounts the welcome credits.

## Payments, plans and the paid API (`server/billing`, pages `/billing`, `/pay/:code`, Admin → Payments)

- Payers pick a network and coin (USDT, USDC or the network's own coin on Ethereum, BNB Chain, Polygon, Solana) and send an exact, unique amount to `PAY_EVM_ADDRESS` / `PAY_SOLANA_ADDRESS`. Every 20 seconds the watcher (`server/billing/watcher.ts`) reads incoming transfers on public RPCs (`PAY_RPC_*` first): token logs, a few blocks of the network's own coin, and the Solana wallet's signatures. A transfer of an open order's exact amount starts the same check a pasted hash does (the hash is still accepted). The check confirms the coin's own token contract, the exact amount, success, confirmations, the order's window, and a second provider's agreement. A match applies the order (a plan, or API balance); anything else waits in Admin → Payments with the reason. No private key is used or stored anywhere.
- An unset or invalid wallet turns its networks off (logged once). Native coins are priced from four public sources at issue time and locked for 30 minutes. Telegram alerts need `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` (send-only).
- Plans, the offer and automatic application are settings (Admin → Plans & pricing, `app_settings` key `billing`); an order keeps the terms it was sold with. Migrations 12 and 13 hold the tables.
- A plan can be paid for 1 to 6 months in one order, at the per-month price of the day it is ordered. An account's plan never runs more than 6 months past today, counting its unpaid orders (`MAX_PLAN_MONTHS` and `prepayableMonths` in `shared/billing.ts`); the server refuses an order past that with 409 `prepay_limit`.
- Live check after a deploy: `node ~/curialy-tools/payments/billing-live.mjs` (a temporary account, a real but unrelated transaction, operator approval, paying ahead, a paid API call; cleans up after itself).

## Rebuilding the host from scratch

1. Ubuntu with Node 22, nginx, certbot, git. Clone this repo to `/srv/curialyai-next` (`chmod 750`), then `pnpm install` (or `npm install`).
2. Snowflake: run [snowflake/setup.sql](snowflake/setup.sql) as ACCOUNTADMIN and create a PAT for the service user.
3. Tiger Cloud: create a service and put its connection string in `TIGER_DATABASE_URL` (tables are created on first start).
4. Secrets: copy [env/curialyai.env.example](env/curialyai.env.example) to `/etc/curialyai.env` and [env/snowflake-proxy.env.example](env/snowflake-proxy.env.example) to `/etc/snowflake-proxy.env`, fill them in, then `chmod 600` both (root-owned). Set the admin password with `sudo node scripts/set-admin-password.mjs` (prompts; writes the hash and a session secret).
5. Bridge: `mkdir -p ~/snowflake-proxy && cp deploy/snowflake-proxy/proxy.js ~/snowflake-proxy/`; for several accounts, write `~/snowflake-proxy/pool.json` from [pool.example.json](snowflake-proxy/pool.example.json) (`chmod 600`).
6. Services: copy `deploy/systemd/*` to `/etc/systemd/system/` (including the `snowflake-proxy.service.d/` drop-in), then `sudo systemctl daemon-reload && sudo systemctl enable --now snowflake-proxy`.
7. Sandbox: `sudo deploy/sandbox/setup-sandbox.sh`.
8. Build and start: `deploy/deploy.sh` (or `npm run build && sudo systemctl enable --now curialyai`).
9. Web: install [nginx/curialyai.conf](nginx/curialyai.conf) as a site and run `certbot --nginx -d curialy.tech -d www.curialy.tech`.
10. GitHub OAuth app: callback `https://curialy.tech/api/auth/callback/github`, scopes `read:user user:email repo`.

## Day-to-day

- Deploy: `deploy/deploy.sh` (refuses an uncommitted tree; typecheck, tests, build with the previous build kept as `dist-prev/`, restart, health check). Add `--bridge` when `deploy/snowflake-proxy/proxy.js` changed. The first boot of a new build applies its migrations; take a Tiger fork first when a release adds one.
- Roll back: `deploy/deploy.sh --rollback`.
- Logs: `journalctl -u curialyai -f`, `journalctl -u snowflake-proxy -f`.
- Health: the Integrations page ("Run live model check") probes every route end to end.
- Memory: the box has about 1 GB of RAM. Stop any side instance (`sudo systemctl stop curialy-test`) before building.
- Bridge restarts: delay them (`systemd-run --on-active=4 ...`, as deploy.sh does) when something else is talking through the bridge.
