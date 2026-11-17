# Design intelligence

Curialy's agent gets a design brief for interface work, and its visual test measures the result.
The brief is picked per request from a design knowledge base; the measurements score the page
the way WCAG and current design practice do. Everything lives in `server/agent/design/`. It
plugs into the existing prompt, Dev Team and visual-test paths, with no new tools, no new
dependencies and no database changes.

## How a run uses it

1. **Reading the request** (`intent.ts`). The task's first prompt and the newest message are read
   for the kind of interface (landing page, storefront, dashboard, long-form article, product
   showcase, app, portfolio, docs, game), the register (brand, product, editorial, playful), the
   motion level, and traits such as data, forms, scroll storytelling or 3D. It also reads the
   user's own direction: hex colors, style words, named fonts, "like Stripe", an attached mockup.
   A refusal counts as a refusal: "no purple gradients, no glassmorphism" lists those looks as
   ones to avoid, and the newest message overrides the first prompt ("drop the gradient").
   Backend work gets no brief, even when it mentions interface-sounding words ("an API endpoint
   for analytics metrics"), unless an interface is clearly what is being built ("build a page
   that ..."). A short follow-up on an interface project ("make the buttons bigger") keeps the
   task's character. Matching is deterministic and word-start based, so "long-form" is not a form,
   "stores signups" is not a store, and a magnifying-glass icon is not glassmorphism.
2. **Reading the workspace** (`workspace.ts`). It notes the framework, styling, libraries, how many
   CSS custom properties exist and whether a `DESIGN.md` is present. Reads are bounded and confined
   to the workspace. An existing design system is extended, never replaced.
3. **Retrieval** (`retrieve.ts`). Every brief carries the four core entries: the direction
   process, the user's direction, generic tells to avoid, and the quality floor. Then come the
   recipe for the detected surface, the entries that recipe depends on (`related`), and the
   best-scoring remaining entries, within about 5,200 characters (more for expressive motion or
   3D). A brief carries 12 or 13 of the knowledge base's 42 entries. When the user asked for a
   look on purpose (glassmorphism, a purple gradient, emoji), the rule warning against it is
   dropped (`unless`).
4. **The brief** (`brief.ts`). It is sent as a system block after the static prompt, so that
   prompt stays byte-identical, and it is identical on every turn of a run. A new project writes
   the direction to `DESIGN.md` before any UI code, then defines it as CSS custom properties. An
   existing project follows its own system, or its `DESIGN.md`. Dev Team roles get their own
   variants:
   - the Architect fills the plan's `design` field (concept, palette, type, layout, motion,
     what to avoid);
   - the Engineer builds to it;
   - the Reviewer checks against it with a shorter brief.
5. **The visual test** (`browser.ts` `visualCheck`, `tools.ts`). `test_preview_visual` returns
   the page at desktop size and the top of the page at phone width (390×844, reduced motion on),
   plus a design audit:
   - `collector.ts` measures inside the cloud browser, so this server only receives JSON;
   - `audit.ts` scores the measurements into `fix`, `improve` and `note` findings, at most about
     1,800 characters in the model's result and also shown in the run log.

   The phone pass runs in a tab of its own, so the task's shared browser page (used by the
   other browser tools and shown in the operator's live view) is never left in phone or
   reduced-motion state. A cancelled run stops the check between and during its steps. Scrolls
   are instant (generated sites often set `scroll-behavior: smooth`), an inner scroller is used
   when the document itself doesn't scroll, and a reveal still under way gets a second look
   before its text counts as hidden. What the collector returns comes from the page's own
   JavaScript, so it is rebuilt with every field type-checked and every string clipped
   (`cleanFacts`) before anything reads it. Desktop screenshots stop at 7,800 px, because the
   model API refuses taller images.
6. **The design check** (`runner.ts` `designCheck`). When shell verification has passed, the
   harness sends interface work back once in each of these cases:
   - the interface was never looked at;
   - it changed after its last visual test;
   - the last audit still has `fix` findings.

   There are at most two such checks per run, and only with at least 10 turns and two
   self-healing iterations left, and (for free accounts) credits for about six more turns.
   Changes are compared by content, so a rebuild that rewrites identical files is not a change,
   and tests, stories, build output and test reports are not the interface. If a follow-up still
   runs out of turns, the answer accepted before it is delivered (after one more verification
   run). The checks never fail a run, use no self-healing iteration and never switch models.

## What the audit measures

| Check | Level | Threshold | Basis |
|---|---|---|---|
| Text contrast | fix | 4.5:1, or 3:1 for 24 px and up (18.66 px bold), unrounded. Gradient backgrounds use their worst stop; text over images is skipped | WCAG 2.2 1.4.3 |
| Sideways scroll | fix / note | none at 390 px or at 1280 px; the widest offenders are named. Overflow the viewport cuts off (`overflow-x: hidden` on html/body) is a note to check nothing important is lost | WCAG 1.4.10 |
| Zoom blocked, missing viewport meta, missing `lang` | fix | — | WCAG 1.4.4, 3.1.1 |
| Controls without a name, fields without a label, images without alt | fix | — | WCAG 4.1.2, 1.3.1, 1.1.1 |
| Focus style | fix | a visible change on focus for the first 14 controls | WCAG 2.4.7 |
| Target size | fix / improve | under 24×24 px and crowded (fix); under 44 px on the phone layout (improve) | WCAG 2.5.8, 2.5.5 |
| Content hidden at rest | fix / improve | text still invisible after scrolling the page with reduced motion on | impeccable, WCAG 2.3.3 |
| Lorem ipsum, placeholder names | fix / improve | — | content |
| Type | improve | body under 16 px (14 px in dense UI), text under 12 px, largest heading under 1.5× body, headings over 104 px (desktop) or most of a phone screen, more than 10 sizes, line-height under 1.35, lines over 85 characters, more than 3 families, declared fonts not loaded | Material 3, USWDS, WCAG 1.4.8 |
| Motion | improve | animation without a reduced-motion rule (not reported when linked stylesheets can't be read from the preview's opaque origin), loops under reduced motion, `transition: all` on 5 or more elements, keyframes animating layout properties | WCAG 2.3.3, 2.2.2, web.dev |
| Input text under 16 px on phones | improve | iOS zooms on focus | Vercel guidelines |
| Layout shift | improve | CLS over 0.1 | Core Web Vitals |
| Template tells | note | purple gradients, gradient text, glass on 3 or more large elements, the same shadow on 6 or more elements, eyebrows above 3 or more headings, accented words, emoji as icons, a default font only, filler words, and warm cream paper behind a serif display outside reading pages (the newer "tasteful" default) | anthropic-frontend-design-skill, impeccable, benchmark judging |

Contrast is measured where the text is painted (hit testing at its first line), against the worst
stop of a gradient. Text over an image, video, canvas, filter, blend mode or painted
pseudo-element is left unscored rather than guessed. Notes never block anything, and looks the
user asked for are not reported. Automated checks see
part of the picture: in published studies, tools find roughly 40-57% of accessibility barriers.
The brief keeps keyboard, screen-reader and visual judgement with the agent and the Reviewer.

## Adding knowledge

Entries live in `server/agent/design/knowledge/*.ts`. Each entry is one object:

```ts
{
  id: "scroll-motion",            // kebab-case, stable
  title: "Scroll-driven sections",
  discipline: "motion",           // process, typography, color, layout, imagery, copy, motion,
                                  // immersive, components, accessibility, performance, surface
  needs: ["scroll"],              // only when the request has this trait
  signals: ["parallax", "sticky"],// request words that raise its rank (lowercase)
  optional: false,                // true: only when a signal matches
  rules: [
    "Concrete, numeric guidance in Curialy's own words.",
    { text: "A warning about a look...", unless: ["glassmorphism"] }, // dropped when asked for
  ],
  sources: ["web.dev scroll-driven animations", "corpus:twoclipping-551116"],
}
```

- Recipes (`discipline: "surface"`) name their `surfaces`, and list the `related` entries that
  kind of interface depends on.
- `knowledgeProblems()` checks ids, sources, lengths, slugs and related ids. `server/design.test.ts`
  runs it.
- A new kind of interface needs a value in `Surface` (types.ts), phrases in `SURFACE_PHRASES`, a
  register in `REGISTER_OF`, a label in `SURFACE_LABEL` and a recipe.
- A new audit check takes three things: a measurement in `PageFacts` (types.ts) and the
  collector, a rule in `audit.ts`, and a fixture test. The collector runs in the page as source
  text, so it must stay self-contained and must not touch storage.

## Style archetypes and synthesis

Fifteen complete visual systems from the staged anime and entertainment templates
(`component-library/anime-templates/`, two batches) are in `server/agent/design/knowledge/archetypes.ts`:
Slice of Life, Kuro Cinema, Anime Arcade, Frame Anime, Shonen Hub, Nebula Anime, Anime Grid, Otaku OS,
Sakura Stream, Kitsune Flix, and Senpai+, Anime Live, Minimal Otaku, Anime Vault and Hyperanime.
Each has the template's own tokens (with a text-safe shade where a template's muted or accent colour
is under 4.5:1 as text; where a label on the accent fails too, as with Minimal Otaku's red, the shade
is the accent fill as well), its font pairing, its signature blocks, layout and motion, the subjects
it suits beyond anime (`fits`: Kuro for fashion, Otaku OS for developer portals, Anime Grid for job
boards, Senpai+ for premium SaaS tiers, Anime Live for communities and live webinars, Minimal Otaku
for Swiss portfolios and brutalist architecture, Anime Vault for museum archives, research
repositories and luxury registries, Hyperanime for NFT drops and esports festivals…), request
signals, and the looks it is built on (`grants`).

`synthesis.ts` decides when they apply and how they mix: anime or entertainment work (unambiguous
words: anime, manga, streaming site, episodes…), or a subject or style that clearly fits one (two
signals or a fit; on equal points a phrase that names the subject beats a single word). A design is
never one template: the base archetype gives tokens, type, layout and motion; two partners (three
when the request names a block only another archetype has) lend named blocks (what the request asks
for, from the base while it has room beside its hero, else from the mixture, the base's complements
or any archetype; otherwise their signature block, never their chrome) rebuilt in the base's
language; at most half of one archetype's blocks. The brief gets a
"Style synthesis" section with the one token set (`--bg`, `--surface`, `--line`, `--text`,
`--muted`, `--accent`, `--on-accent`, radius, fonts), the blocks to combine, and the rules. The
looks the base and the borrowed blocks are built on (violet, gradient text, glass, marquee, tasteful,
eyebrow, reflex type, numerals) are deliberate there, so the matching generic-tell rules (`look` on a rule)
and audit notes are dropped. A refused look ("no neon") rules out the archetypes built on it.

Their blocks are registered in the component library (`anime-*` ids, `archetype` in the metadata)
with one token set per archetype (`component-library/tokens/anime-*.json`, written by
`scripts/components/export-archetypes.mts` from archetypes.ts), so `add_components` re-skins blocks
of several archetypes to one theme, and a plan that leans on one archetype says to mix. The library
copies are text-safe in their own theme too: the importer writes shorthand colours in full and puts
the token set's `replaced` shades in place of the template colours that fail.

## Motion library and mixture

The ten motion suites and the scroll motion mock (`component-library/motion-components`,
`component-library/motion-mocks`) are catalogued in `knowledge/motion.ts`: ten families and 100
pieces, each with a slot (hero, type, scroll, surface, control, navigation, feedback, data,
ambient), a cost (CSS, script on events, continuous loop), request signals, the looks it is built
on, and whether it is a study made for show (glitch, digital rain, gravity, particle bursts, cursor
trails, audio visualizers). New rules: `motion-mixture` (a few pieces by job, one continuous
animation, the design's tokens and timing, reduced-motion end states), `interactive-motion`
(magnetic pull, tilt, press, pointer light, with numbers) and `scroll-kit` (the mock's reveal and
progress recipes).

`synthesis.ts` (`motionMixture`) applies when a request names pieces or asks for motion: what it
names, longest phrase first (a phrase inside a longer match belongs to that one); then, for a
request that asks for motion in general, defaults that suit its kind of site (landing, portfolio,
dashboard, docs, storefront, media, game…), one per open slot, varied by the request's text. At most
one continuous animation from the defaults (two only when the user names them, never on screen
together); a hero loop by default only when nothing is named or the hero or background is
mentioned; studies made for show only by name; "no 3d", "no particles", "static" are honoured. Only
the pieces the user named make their looks deliberate (glass, gradient text, violet). The brief gets
a "Motion mixture" section with the pieces and their component ids, the shared timing tokens, the
budget and the reduced-motion rule; the pieces go on the style synthesis's tokens when there is one.

## Curialy UI design system

Curialy UI is the agent's React 19 design system: accessible components, page templates, blocks,
themes and docs written for coding agents. It is a white-labelled build of an MIT-licensed open-source
system. Its provenance, the mapping and the update procedure are in `design-systems/curialy-ui/README.md`
(maintainers only). The code is in `server/design-systems/ui-system.ts` and
`server/agent/ui-system-tools.ts`. **The upstream name appears nowhere the site serves or says.**
`server/ui-system.test.ts` scans the snapshot, the packages, the tool definitions, every command's
answer, the contexts, the briefs and the recipes for it.

**When a run builds on it** (`uiFit`, decided with the brief):
- *project*: the workspace depends on `@curialy/ui`.
- *requested*: the user names it.
- *recommended*: app, dashboard and docs surfaces, and general requests with app traits (admin,
  settings, sign-in, checkout, kanban, inbox, CRUD tables, consoles, portals).
- *available*: storefronts, and general requests with forms or data.
- *none*:
  - a refusal;
  - another framework, component system or styling stack (Vue, Svelte, MUI, Chakra, Mantine, Radix,
    shadcn, Headless UI, Bootstrap, Tailwind, plain HTML);
  - the style archetypes;
  - brand, editorial, portfolio, showcase, media and game surfaces.

In chat mode it is offered only when the user names it.

**What the agent gets:**
- A fixed-size context block (about 420 tokens) with the workflow and the package rule. The tools
  add about 630 tokens.
- In the brief: the direction becomes a Curialy UI theme, the Architect names each screen's
  template, and the Reviewer runs `design_system check`.
- Two tools:
  - `design_system` answers the system's CLI commands from the snapshot: `build`, `search`,
    `component`, `hook`, `docs`, `template`, `themes`, `setup` and `check`.
  - `design_template` writes a template into the workspace with a marker. It never replaces a file
    of the user's, and read-only roles are refused.

How well `build` matches the upstream CLI was measured on 40 ideas: our starting template is the
CLI's in 25, and one of the CLI's candidates in 37.

**Packages come from the site, never the registry.** `@curialy/ui` and `@curialy/ui-theme-<slug>` are
the verified upstream packages, rewritten under one consistent mapping, without install scripts,
and with Meta's MIT licence. The app serves them at `/ui-kit/<file>.tgz`, which is public and
immutable. Projects install them by URL, and npm records their sha512 in the lockfile.

`run_command` refuses commands that:
- install those names from the registry (anything published there under them would be someone
  else's);
- run or install the upstream scope or the unscoped upstream name (an unrelated package);
- install while a `package.json` lists one of those.

`design_system check` flags the same problems, and also mixed releases, React below 19, a missing
StyleX peer, the CSS layer order, a missing theme, imports that are not entries, and escape hatches
the agent added.

**Building in a task sandbox:** an app on the system compiles 2,400 to 3,800 modules. Node sizes its
default heap from the sandbox's 470 MB (about 256 MB), so `vite build` aborted. Raising the heap
without swap thrashed. Every E2B sandbox now gets 1.5 GB of swap, and when swap is active, Node gets
`--max-old-space-size=1024` (`e2b.ts`). The dashboard template then builds in about 25 s.

This was checked end to end in a default sandbox, with Vite 6.4.6 and @vitejs/plugin-react 4.7.0. The
cloud browser's visual check rendered the results without console errors:
- the dashboard on a theme;
- the dashboard on a runtime `defineTheme`;
- a template that calls `stylex.create()`, compiled with `@stylexjs/unplugin`.

The templates are content only. The audit flags what the agent adds: a `<main>`, an `h1`, names for
icon buttons, and the phone layout.

## What the benchmark changed

Six benchmark tasks were run on production before and after the release. In the after set, a blind
judging found that five of six designs had converged on the newer generated default: cream paper,
a serif display and an earthy accent. Judges also flagged visible "sample" disclaimers on marketing
pages and mixed light and black weights inside one headline. The knowledge base now names that
default as a tell (unless asked for), keeps placeholder notes in the summary rather than on
marketing pages, asks for a drawn likeness of products without photos, and keeps one weight per
headline. The audit notes the cream-and-serif combination outside reading pages. These changes came
after the benchmark and are not yet measured.

## The preview

The preview runs sandboxed (an opaque origin), so module scripts, `crossorigin` stylesheets and
fonts are cross-origin requests to this server. They were blocked ("from origin 'null'") until
preview responses carried `Access-Control-Allow-Origin: *`. Before that, Vite builds showed a blank
page in the Preview tab and in the visual test, and agents spent turns rewriting their builds to
work around it. Previews are capability URLs without cookies, so this exposes nothing a link
holder couldn't fetch already. Preview tokens are redacted wherever a preview URL appears in tool
output, console errors included.

## Cost

- The brief is about 2,300-2,700 tokens per model turn, and only interface tasks get it. In
  production, runs with a visual test take 3-9 turns, so that adds roughly 0.3-0.7 credits to a
  free account's run.
- The audit adds about 10-20 s and one phone screenshot (about 450 image tokens) to each visual
  test.

## Sources and attribution

The practice sources are:
- WCAG 2.2 and its Understanding documents, and the WAI-ARIA Authoring Practices;
- web.dev (Core Web Vitals, fonts, images, animations) and MDN;
- Material 3, IBM Carbon, Radix Colors and the W3C Design Tokens specification 2025.10;
- the Vercel Web Interface Guidelines, Anthropic's frontend-design skill and the impeccable
  catalogue of generated-UI tells;
- NN/g, USWDS, GOV.UK, Butterick's Practical Typography, Baymard and the WebAIM Million 2026.

The motion and immersive lessons were studied from the prompt corpus
[yihui-dev/awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos)
(MIT License, Copyright (c) 2026 yihui-dev), which collects 703 prompts and posts. As its README
says, every video and prompt belongs to its creator. Curialy's knowledge base states the
principles in its own words and does not copy prompt text. Only principles that work on real
pages were kept: per-beat flashes, camera shake and other video-only effects are listed as what
not to ship. These corpus entries are cited:

| Corpus entry | Creator | Category | Informs |
|---|---|---|---|
| [0xkarmi-129839](https://x.com/0xKarmi/status/2108495927988129839) | 0xKarmi | motion | `timelines` |
| [0xnicc0-516612](https://x.com/0xnicc0/status/2107217691505516612) | 0xnicc0 | motion | `state-transitions` |
| [0xsolty-735200](https://x.com/0xSolty/status/2102888414219735200) | 0xSolty | 3d | `canvas-2d` |
| [agioyaz-986461](https://x.com/AGIOyaZ/status/2103145567945986461) | AGIOyaZ | 3d | `explainers` |
| [aichrislee-378670](https://x.com/aichrislee/status/2107985027254378670) | aichrislee | explainer | `webgl-3d` |
| [archiveexplorer-560622](https://x.com/ArchiveExplorer/status/2106732275685560622) | ArchiveExplorer | explainer | `direction-first` |
| [astrothewizard-618782](https://x.com/AstroTheWizard/status/2103629247751618782) | AstroTheWizard | explainer | `explainers`, `surface-editorial` |
| [brainextends-606193](https://x.com/brainextends/status/2103801834930606193) | brainextends | motion | `scroll-motion` |
| [bthreeagency-827092](https://x.com/BThreeAgency/status/2103739079745827092) | BThreeAgency | 3d | `user-direction` |
| [curieuxexplorer-016717](https://x.com/CurieuxExplorer/status/2103373314354016717) | CurieuxExplorer | interactive | `explainers` |
| [daniel-haida-636937](https://x.com/daniel_haida/status/2104139720829636937) | daniel_haida | motion | `direction-first`, `generic-tells`, `surface-showcase` |
| [everestchris6-399895](https://x.com/everestchris6/status/2104965415164399895) | everestchris6 | 3d | `direction-first`, `webgl-3d`, `surface-landing` |
| [fleyta88-443662](https://x.com/fleyta88/status/2108249741125443662) | fleyta88 | explainer | `motion-orchestration` |
| [flxrnc-251921](https://x.com/flxrnc/status/2108242454105251921) | flxrnc | motion | `timelines` |
| [froessell-562325](https://x.com/froessell/status/2103789415323562325) | froessell | interactive | `surface-game` |
| [gdgtify-393073](https://x.com/Gdgtify/status/2107054188836393073) | Gdgtify | motion | `explainers`, `surface-editorial` |
| [godsboy7777-150194](https://x.com/GodsBoy7777/status/2103117450854150194) | GodsBoy7777 | interactive | `explainers` |
| [howdevelop-733090](https://x.com/HowDevelop/status/2103840883812733090) | HowDevelop | motion | `surface-showcase` |
| [humzaakhalid-537875](https://x.com/humzaakhalid/status/2106640261623537875) | humzaakhalid | motion | `showcase-effects` |
| [iamtanzil-120030](https://x.com/iamtanzil_/status/2103459843831120030) | iamtanzil_ | motion | `motion-orchestration` |
| [ik-builds-585923](https://x.com/ik_builds/status/2103890476885585923) | ik_builds | motion | `imagery` |
| [khlaseek-dsgner-877659](https://x.com/Khlaseek_dsgner/status/2108167809997877659) | Khlaseek_dsgner | motion | `motion-orchestration` |
| [l3d1c-632524](https://x.com/l3d1c/status/2104649028193632524) | l3d1c | motion | `user-direction` |
| [majidmanzarpour-927543](https://x.com/majidmanzarpour/status/2102476258948927543) | majidmanzarpour | motion | `canvas-2d` |
| [milos-gis-317580](https://x.com/milos_gis/status/2103751211040317580) | milos_gis | 3d | `surface-dashboard` |
| [morse-369333](https://x.com/__morse/status/2103485566570369333) | __morse | 3d | `motion-orchestration`, `state-transitions` |
| [mrkindey-267498](https://x.com/MrKindey/status/2107817784432267498) | MrKindey | interactive | `webgl-3d` |
| [niegramotny-197521](https://x.com/_nieGRAMotny_/status/2103128800909197521) | _nieGRAMotny_ | interactive | `surface-game` |
| [nonbiri-ai-110674](https://x.com/nonbiri_AI/status/2104122410027110674) | nonbiri_AI | motion | `showcase-effects` |
| [notdwd-998633](https://x.com/notdwd/status/2103995183255998633) | notdwd | motion | `showcase-effects`, `surface-storefront` |
| [op7418-814408](https://x.com/op7418/status/2103724883301814408) | op7418 | interactive | `surface-game` |
| [pound75423-464968](https://x.com/pound75423/status/2103722556918464968) | pound75423 | motion | `showcase-effects` |
| [proanaliteg-458642](https://x.com/proanaliteg/status/2103895246593458642) | proanaliteg | motion | `user-direction` |
| [raphaelaubryy-687877](https://x.com/RaphaelAubryy/status/2103413596822687877) | RaphaelAubryy | 3d | `generic-tells` |
| [redpersongpt-284430](https://x.com/redpersongpt/status/2103807094554284430) | redpersongpt | interactive | `surface-landing` |
| [stokebuilder-356793](https://x.com/stokebuilder/status/2103896101120356793) | stokebuilder | explainer | `direction-first` |
| [tanabe-fragm-322001](https://x.com/tanabe_fragm/status/2107644501372322001) | tanabe_fragm | 3d | `webgl-3d` |
| [tanabe-fragm-706979](https://x.com/tanabe_fragm/status/2103802156675706979) | tanabe_fragm | motion | `timelines` |
| [thegrootdev-966114](https://x.com/TheGrootDev/status/2103516567824966114) | TheGrootDev | motion | `state-transitions` |
| [twoclipping-551116](https://x.com/twoclipping/status/2106101258834551116) | twoclipping | motion | `scroll-motion` |
| [ultimaxbt-549714](https://x.com/ultimaxbt/status/2108210884799549714) | ultimaxbt | 3d | `surface-showcase` |
| [verbove-268381](https://x.com/verbove/status/2103483957266268381) | verbove | explainer | `motion-orchestration`, `timelines` |
| [voxyz-ai-345550](https://x.com/Voxyz_ai/status/2103117246860345550) | Voxyz_ai | explainer | `webgl-3d` |
| [zacxbt-944604](https://x.com/zacxbt/status/2103808699466944604) | zacxbt | interactive | `canvas-2d` |
