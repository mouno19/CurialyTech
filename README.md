# Curialy AI

Autonomous coding-agent platform behind [curialy.tech](https://curialy.tech): a glassbox UI that
streams the agent's thinking, terminal, diffs and phase timeline live, a sandboxed tool loop
with self-healing verification, 28 models across four routes, Dev Team mode (Architect,
Engineer, Reviewer), GitHub integration, live browser, visual preview testing and deploy
previews.

## Accounts, credits and sandboxes

- Anyone signs in with GitHub (profile and email only; repository access is a separate "Connect
  repositories" step). The operator account also has password sign-in and the Admin page.
- Every task, file, deployment and GitHub connection belongs to one account; routes check it.
- A new account gets welcome credits once (default 60); they never refill. Following the X account
  and posting about the site (`server/rewards.ts`, checked with `X_BEARER_TOKEN`) each add credits
  once, and both together open a refilling window while that offer lasts. A plan or an allowance set
  for one account refills too. One credit is 25,000 weighted tokens on a standard model
  (`shared/credits.ts`); runs are charged per model response and stop when the account runs out.
  Promo codes and grants add bonus credits.
- Public live previews, the Research Agent and clicking/typing on third-party sites are
  operator-only.
- With `E2B_API_KEY` set, every task's commands, installs and builds run in a cloud sandbox of its
  own (`server/agent/e2b.ts`); this server keeps only the task's sources and build output.
- Voice (`server/voice/engines.ts`): dictation in the composer, transcripts of recordings
  (`transcribe_audio`), speech files (`generate_speech`) and reading answers aloud run on Deepgram;
  ElevenLabs is used only for expressive speech on the operator's tasks, within a budget reserve.
  Free accounts pay credits for voice (`shared/credits.ts` VOICE_RATES).
- Design intelligence (`server/agent/design/`): interface work gets a design brief retrieved from a
  design knowledge base for that kind of interface, and `test_preview_visual` returns desktop and
  phone screenshots with a design audit measured in the page (contrast, focus, targets, reflow,
  type, motion, template tells). See [docs/design-intelligence.md](docs/design-intelligence.md).

## Repository map

| Path | What |
|---|---|
| `client/` | React 19 + Vite UI (composer, task workspace, deck panels, integrations) |
| `server/agent/` | Agent runtime: dispatch, loops, tools, sandbox (local or E2B), recovery, Dev Team, events |
| `server/auth.ts`, `server/auth-github.ts`, `server/credits.ts`, `server/rewards.ts`, `server/admin.ts` | Sessions, GitHub sign-in, credits, the X rewards, promo codes, account and admin APIs |
| `server/media/` | Snowflake stage storage and SQL `AI_COMPLETE` |
| `server/db/` | Tiger Cloud Postgres access and migrations |
| `shared/` | Types shared by client and server: model catalog, events, white-label vocabulary |
| `deploy/` | How production runs: systemd units, nginx, model bridge, sandbox setup, env templates, Snowflake SQL, deploy script |
| `scripts/` | Operator scripts (admin password, data migration) |

## Docs

- [SETUP.md](SETUP.md): architecture and local development.
- [deploy/README.md](deploy/README.md): the production host, model routes, rebuilding from scratch, deploy and rollback.
- [docs/design-intelligence.md](docs/design-intelligence.md): the design brief, the design audit, adding knowledge, sources and credits.

## Commands

- `pnpm dev`: development server (`AGENT_SANDBOX=none` runs agent commands as your user).
- `pnpm check`: typecheck (`NODE_OPTIONS=--max-old-space-size=1700` on small hosts).
- `pnpm test`: vitest suite (sandbox, tools, dispatch, recovery, Dev Team, routing).
- `pnpm build`: client and server bundle into `dist/`.
- `deploy/deploy.sh`: production rollout with health check and rollback.
