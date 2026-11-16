# Astryx snapshot

[Astryx](https://github.com/meta/astryx) is Meta's open-source design system (MIT, React 19 and
StyleX): 174 accessible components, 58 page templates, 726 blocks, 7 themes, and docs written for
coding agents. This folder is a pinned, vetted copy of what its CLI serves. Curialy's agent reads it
through two tools:

- `astryx`: build, search, component, hook, docs, template, themes, setup and check.
- `astryx_scaffold`: writes a template into the workspace.

See `server/design-systems/astryx.ts` and `server/agent/astryx-tools.ts`, and the "Astryx design
system" section of `docs/design-intelligence.md`.

**Nothing in this folder runs.** It holds Markdown, TypeScript template sources (written into a
project only when the agent scaffolds one) and JSON. The Curialy server reads files named in
`index.json` and nothing else.

## What is here

| Path | What it is | Comes from |
|---|---|---|
| `snapshot.json` | release, exact install versions, template package ranges, Core's public entries, counts, signature and provenance results, lockfile integrity hashes | the staged install |
| `index.json` | one entry per component, hook, docs node, page, block and theme, with the metadata the ranking uses | the CLI's lists and its exported search index |
| `components/<Name>.md`, `hooks/<name>.md` | `astryx component <Name> --dense`, `astryx hook <name> --dense` | CLI |
| `docs/<route>.md` (`.dense.md`) | `astryx docs <route> --full` (and `--dense` where it is shorter), for every node under the building guides | CLI |
| `templates/pages/<id>.tsx`, `.skeleton.txt`; `templates/blocks/<id>.tsx` | the source `astryx template <id>` writes, and each page's `--skeleton` | CLI |
| `themes/<slug>.json` | each theme's tokens and fonts, read from its built stylesheet, and the module `astryx theme add <slug>` generates | packages, CLI |
| `fixtures/build-kits.json` | the CLI's own `astryx build` answers for 40 ideas: what the ranking tests measure against | CLI |
| `LICENSE` | Astryx's MIT licence (Copyright Meta Platforms, Inc.) | `@astryxdesign/cli` |

The CLI writes its follow-up commands as `npx astryx …`. The snapshot writes them as `astryx …`,
which names the agent's tool. The unscoped npm package `astryx` is unrelated to Astryx, and the CLI
needs Node 22.13, while task sandboxes run Node 20.

## How it was made, and how to update it

```bash
node scripts/astryx/snapshot.mjs --version 0.7.17     # the next release
git diff --stat design-systems/astryx                 # review before committing
npx vitest run server/astryx.test.ts
```

1. **Stage.** The packages are installed at exact versions into `/srv/astryx-stage/<version>/project`
   with `--ignore-scripts`. `npm audit signatures` must then verify a registry signature for every
   package, and a provenance attestation wherever one was published. The script stops if any package
   other than `@astryxdesign/core` or `@astryxdesign/cli` has an install script. Both of those
   scripts were read for 0.7.16, and they only print a hint. Read them again for a new release.
2. **Ask.** `scripts/astryx/jail.sh` runs the CLI through `snapshot-driver.mjs` and
   `theme-module-driver.mjs`. It uses a transient systemd unit with these restrictions:
   - no network (loopback only) and a dynamic user;
   - read-only system, no home, and `/srv` hidden except the staged project (read-only);
   - an empty capability set, and memory and task limits.

   Only stdout comes back. The full run takes about 10 minutes.
3. **Write.** `snapshot.mjs` does the following:
   - checks every answer and the CLI's version;
   - refuses unsafe names and routes;
   - rewrites CLI runners, and records which templates call `stylex.create()` and which packages
     they import;
   - writes this folder. `README.md` is kept.

   Use `--reuse` to redo only this step from the staged answers.

Version 0.7.16 was staged on 2026-11-16. For that release, `npm audit signatures` verified 158 of
158 registry signatures and 86 attestations, and `npm audit` found 0 vulnerabilities.

## Rules the tools keep

- Projects install `@astryxdesign/core`, a theme and `@stylexjs/stylex` at the exact versions in
  `snapshot.json`. All `@astryxdesign/*` packages stay on one release, because a theme names the
  exact Core release it works with.
- `run_command` refuses to run or install the unscoped `astryx` package. It also refuses an install
  while a `package.json` lists that package.
- `astryx check` reads only the workspace's own files:
  - setup: the CSS layer order, the theme stylesheet and `<Theme>`;
  - versions: one release, exact pins, React 19 and the StyleX peer;
  - imports that are not Core entries;
  - escape hatches the agent added: raw `<div>`/`<span>`, quoted hex colours, `px`, imported CSS
    and `@apply`. Lines a scaffolded template already had are not counted.
- About 15 page templates and 24 blocks call `stylex.create()`. Those templates need a StyleX
  compiler in the project, and the scaffold receipt says how to add one.
- A Vite build of an Astryx page compiles about 2,400 to 3,800 modules. That is more than Node's
  default heap allows in a 470 MB sandbox. Every task sandbox therefore gets 1.5 GB of swap, and a
  1 GB Node heap when swap is active (`server/agent/e2b.ts`).
