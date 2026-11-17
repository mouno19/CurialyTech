# Curialy UI snapshot

Curialy UI is the agent's React 19 design system: 174 accessible components, 58 page templates, 726
blocks, 7 themes, and docs written for coding agents. It is a white-labelled build of
[Astryx](https://github.com/meta/astryx), Meta's MIT-licensed open-source design system (0.7.16).

**This README, `UPSTREAM.json` and `scripts/ui-system/` are for maintainers only.** The site never
serves them. Everything else in this folder, everything the agent's tools return, and everything in
the packages projects install is free of the upstream name. `server/ui-system.test.ts` checks that.

Two tools read this folder:

- `design_system`: build, search, component, hook, docs, template, themes, setup and check.
- `design_template`: writes a template into the workspace.

See `server/design-systems/ui-system.ts` and `server/agent/ui-system-tools.ts`. The app serves
`packages/*.tgz` at `/ui-kit/<file>` (`server/design-systems/ui-kit-route.ts`).

**Nothing in this folder runs on the server.** It holds Markdown, TypeScript template sources
(written into a project only when the agent scaffolds one), JSON, and the repacked packages
(installed in task sandboxes).

## What is here

| Path | What it is |
|---|---|
| `snapshot.json` | Release, the repacked packages (file, sha512, size), the registry packages and versions, template package ranges, Core's public entries, counts, signature results. |
| `index.json` | One entry per component, hook, docs node, page, block and theme, with the metadata the ranking uses. |
| `components/`, `hooks/`, `docs/` | The CLI's dense docs (`component --dense`, `hook --dense`, `docs <route> --full`, and `--dense` where it is shorter). The pages on wiring AI tools and on integrations are left out. |
| `templates/pages/`, `templates/blocks/` | The source a template copy writes, and each page's skeleton. |
| `themes/<slug>.json` | Each theme's tokens and fonts, read from its built stylesheet, and its `ui-themes.ts` module. |
| `fixtures/build-kits.json` | The CLI's own `build` answers for 40 ideas: what the ranking tests measure against. |
| `packages/*.tgz` | `@curialy/ui` and `@curialy/ui-theme-<slug>`, repacked from the verified upstream packages. |
| `LICENSE` | The MIT licence (Copyright Meta Platforms, Inc.). It is also inside every package. |
| `UPSTREAM.json` | The upstream project, the package names and versions, integrity hashes and the verification results (maintainers only). |

## The white label

`scripts/ui-system/snapshot.mjs` maps every upstream name with one consistent rule, so code,
styles and translation keys keep matching:

| Upstream | Curialy UI |
|---|---|
| `@astryxdesign/core` | `@curialy/ui` |
| `@astryxdesign/theme-<slug>` | `@curialy/ui-theme-<slug>` |
| `astryx.css` | `styles.css` |
| `astryx-themes.ts` | `ui-themes.ts` |
| identifiers, classes, `data-` attributes, layers, i18n keys (`astryx…`, `Astryx…`, `ASTRYX`) | `cui…`, `Cui…`, `CUI` |
| the name in prose | Curialy UI |
| CLI commands in docs (`npx astryx docs …`) | `design_system docs …` |
| registry install lines in docs | a pointer to `design_system setup` |
| links to the upstream repository, docs site and translations | the link text only |

The script also changes the packages themselves:

- It drops READMEs, changelogs, developer notes, source maps, CLI-only doc modules and the install
  scripts.
- It keeps third-party licence files and Meta's copyright headers. The MIT licence requires them in
  copies, and they don't name the project.
- It removes the core from the themes' `peerDependencies`. Otherwise npm would try to fetch a package
  called `@curialy/ui` from the registry, and anything published there under that name is not ours.

After the rewrite, every JS and TS file must still parse (esbuild, parse only). No file name or byte
of a package, and no file the site serves, may still contain the name. Otherwise the script stops.

## Installs

Projects install the packages from the site, in one command so that the themes find the core.
`design_system setup` prints the command:

```bash
npm install --save-exact https://curialy.tech/ui-kit/curialy-ui-0.7.16.tgz https://curialy.tech/ui-kit/curialy-ui-theme-neutral-0.7.16.tgz @stylexjs/stylex@0.19.2 react@19.3.1 react-dom@19.3.1
```

`run_command` refuses commands that:

- install `@curialy/ui*` by name, which would fetch it from the registry;
- install or run the upstream scope or the unscoped upstream name (an unrelated npm package);
- install while a `package.json` lists one of those.

## How it was made, and how to update it

```bash
node scripts/ui-system/snapshot.mjs --version 0.7.17     # the next upstream release
git diff --stat design-systems/curialy-ui                # review before committing
npx vitest run server/ui-system.test.ts
```

1. **Stage.** The upstream packages are installed at exact versions into
   `/srv/astryx-stage/<version>/project`, with `--ignore-scripts`. `npm audit signatures` must then
   verify every registry signature, and every attestation that was published.
   - The script stops if any package other than the upstream core and CLI has an install script.
   - Both of those scripts were read for 0.7.16, and they only print a hint. Read them again for a
     new release.
2. **Ask.** `scripts/ui-system/jail.sh` runs the upstream CLI through `snapshot-driver.mjs` and
   `theme-module-driver.mjs`. It uses a transient systemd unit with these restrictions:
   - no network (loopback only) and a dynamic user;
   - read-only system, no home, and `/srv` hidden except the staged project (read-only);
   - an empty capability set, and memory and task limits.

   Only stdout comes back. The full run takes about 10 minutes.
3. **White-label and write.** The script rewrites, repacks, parses, checks for leaks and writes this
   folder, keeping this README. Use `--reuse` to redo only this step from the staged answers.

Version 0.7.16 was staged on 2026-11-16. For that release, `npm audit signatures` verified 158 of
158 registry signatures and 86 attestations, and `npm audit` found 0 vulnerabilities.

## Building in a task sandbox

A Vite build of a Curialy UI page compiles 2,400 to 3,800 modules. That is more than Node's default
heap allows in the sandboxes' 470 MB. Every task sandbox therefore gets 1.5 GB of swap, and a 1 GB
Node heap when swap is active (`server/agent/e2b.ts`). Use Vite 6.4.6 with @vitejs/plugin-react 4.7.0,
because Vite 7 and later need Node 20.19.

About 15 page templates and 24 blocks call `stylex.create()`. Those templates need
`@stylexjs/unplugin@0.19.2` (`stylex.vite()`), and the scaffold receipt says so.
