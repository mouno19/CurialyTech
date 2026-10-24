# Curialy AI — setup & operations

React 19 + Vite client, Express + tRPC server, SQLite persistence. The autonomous coding agent lives in `server/agent/`.

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Agent runtime | `server/agent/runner.ts` | Model dispatch, streaming tool loop, phase tracking, harness verification + self-healing (max 4 iterations, escalates Sonnet 4.5 → Opus 5.5 after 2 failures). |
| Tools | `server/agent/tools.ts` | `update_plan`, `list_files`, `read_file`, `write_file`, `edit_file`, `delete_file`, `search_files`, `run_command`, plus `web_fetch` / `delegate_research` (Manus) when Web is on. |
| Sandbox | `server/agent/sandbox.ts` | Per-task dirs in `/srv/curialy-workspaces/<task>`; commands run as `curialy-agent` via `systemd-run --scope` (512 MB, 150% CPU, 256 tasks) + `setpriv`; one command at a time. File tools resolve through `realpath` and `O_NOFOLLOW`. |
| Providers | `server/agent/providers.ts` | Cortex via the local bridge (`127.0.0.1:8082`, holds the Snowflake PAT), RelayStation (Anthropic Messages format), Cortex `inference:complete` for Llama/Mistral (bridge route `/cortex/inference`), Manus v2 (`task.create` + polling). |
| Event log | `server/agent/bus.ts`, `store.ts` | Every event is persisted with a per-task sequence number (`agent_events`) and fanned out live; token deltas coalesce over ~90 ms. |
| HTTP | `server/agent/routes.ts` | REST under `/api/agent/*`; SSE at `/api/agent/tasks/:id/events?after=<seq>` (replay then live). All require the admin session. |
| Auth | `server/auth.ts` | Single operator: scrypt `ADMIN_PASSWORD_HASH`, HS256 session cookie signed with `SESSION_SECRET`, login rate limit, same-origin check on mutations. |
| UI | `client/src/pages/TaskWorkspace.tsx`, `components/deck/*` | Split pane: conversation and final output on the left; phase stepper, activity, thinking, terminal, diffs and raw log on the right. |

## Environment (`/etc/curialyai.env`, root:root 600)

```
ADMIN_PASSWORD_HASH=scrypt:...      # node scripts/set-admin-password.mjs
SESSION_SECRET=<48+ random chars>
RELAY_API_URL=https://relaystation.world
RELAY_API_KEY=...
MANUS_AGENT_API_URL=https://api.manus.ai
MANUS_AGENT_API_KEY=...
MANUS_AGENT_PROFILE=lite
CORTEX_BRIDGE_URL=http://127.0.0.1:8082
AGENT_WORKSPACE_ROOT=/srv/curialy-workspaces
# AGENT_SANDBOX=none                # local development only: runs commands as the app user
```

The Snowflake PAT is only in `/etc/snowflake-proxy.env`, read by `snowflake-proxy.service`.

## Host prerequisites (already applied on curialy-tech)

- User `curialy-agent` (system, locked password, no sudo); `/srv/curialy-workspaces` owned by it, mode `2770`; `ubuntu` in group `curialy-agent`.
- iptables chain `CURIALY_SANDBOX` (owner match on `curialy-agent`) rejects loopback ports 22/3000/3100/8082, link-local/metadata, and RFC1918/CGNAT ranges. Persisted with `netfilter-persistent save`.
- `/srv/curialyai*` mode `750` so the sandbox user cannot read app source, the DB or backups.

## Commands

- `pnpm check` — typecheck (≈3 min on the 1 GB VPS; uses `NODE_OPTIONS=--max-old-space-size=1700`).
- `pnpm test` — vitest (sandbox confinement, tools, dispatch, auth).
- `pnpm build` — client + server bundle into `dist/`.
- `sudo systemctl restart curialyai` — restart after env or build changes.
