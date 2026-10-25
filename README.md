# Curialy AI

Autonomous coding-agent platform behind [curialy.tech](https://curialy.tech): a glassbox UI that
streams the agent's thinking, terminal, diffs and phase timeline live, a sandboxed tool loop
with self-healing verification, 28 models across four routes, Dev Team mode (Architect,
Engineer, Reviewer), GitHub integration, live browser, visual preview testing and deploy
previews.

## Repository map

| Path | What |
|---|---|
| `client/` | React 19 + Vite UI (composer, task workspace, deck panels, integrations) |
| `server/agent/` | Agent runtime: dispatch, loops, tools, sandbox, recovery, Dev Team, events |
| `server/media/` | Snowflake stage storage and SQL `AI_COMPLETE` |
| `server/db/` | Tiger Cloud Postgres access and migrations |
| `shared/` | Types shared by client and server: model catalog, events, white-label vocabulary |
| `deploy/` | How production runs: systemd units, nginx, model bridge, sandbox setup, env templates, Snowflake SQL, deploy script |
| `scripts/` | Operator scripts (admin password, data migration) |

## Docs

- [SETUP.md](SETUP.md): architecture and local development.
- [deploy/README.md](deploy/README.md): the production host, model routes, rebuilding from scratch, deploy and rollback.

## Commands

- `pnpm dev`: development server (`AGENT_SANDBOX=none` runs agent commands as your user).
- `pnpm check`: typecheck (`NODE_OPTIONS=--max-old-space-size=1700` on small hosts).
- `pnpm test`: vitest suite (sandbox, tools, dispatch, recovery, Dev Team, routing).
- `pnpm build`: client and server bundle into `dist/`.
- `deploy/deploy.sh`: production rollout with health check and rollback.
