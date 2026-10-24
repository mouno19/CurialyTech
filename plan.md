# Curialy AI implementation plan

## Product direction

Curialy AI is a focused agent workspace for turning plain-language requests into bounded, reviewable work. The dashboard keeps the reference composition: a persistent left rail for navigation and skill context, a central workbench for task creation and results, and a compact right rail for recent work and genuine activity.

## Design

- **Design Movement:** editorial dark productivity cockpit with quiet neon accents.
- **Core Principles:** calm hierarchy, visible system state, small purposeful motion, and progressive disclosure.
- **Color Philosophy:** charcoal surfaces reduce visual noise while violet marks action and mint signals healthy capability; warning and failure colors are reserved for real states.
- **Layout Paradigm:** asymmetric three-rail workspace rather than a centered marketing grid; the composer is the visual anchor and supporting context stays peripheral.
- **Signature Elements:** violet active rail, mint status pips, and compact uppercase eyebrow labels.
- **Interaction Philosophy:** every control either changes task behavior, opens a real view, or clearly explains why it is unavailable.
- **Animation:** short ease-out transitions for drawers, toasts, and state changes; no looping decorative motion; honor reduced motion.
- **Typography System:** Inter-like system sans for interface text, with heavier display weight for task prompts and restrained mono labels for metadata.
- **Brand Essence:** a practical AI workbench for people who want capable help without losing visibility; clear, grounded, composed.
- **Brand Voice:** direct and encouraging. Example lines: “Bring the messy part.” and “Your workspace is ready for the next useful step.”
- **Wordmark & Logo:** a simple violet orbit/compass mark paired with the Curialy wordmark, built in CSS/SVG so it remains crisp at small sizes.
- **Signature Brand Color:** electric violet `#8B75FF`.

## Implementation approach

1. Replace the placeholder Home page with a responsive Curialy shell using reusable sidebar, header, composer, card, activity, and task components. Use local browser persistence for preferences and task history when a signed-in database user is not available, and label that mode honestly in the UI.
2. Add a typed skill registry in `shared/skills.ts` and use it for dashboard cards, `/skills`, task skill selection, and configuration states.
3. Add a server-side `tasks.create` tRPC procedure that validates input, selects skills deterministically, calls the platform’s server-only OpenAI-compatible LLM surface when configured, and otherwise returns a truthful configuration response. No provider key reaches the browser.
4. Add first-class routes for dashboard, skills, tasks, discover, library, creations, automations, integrations, and settings. Keep task detail useful with locally persisted messages, status, plan, skills, and source placeholders only when genuine.
5. Add route manifest, project logo metadata, environment/configuration documentation, and a safe `.env.example` if needed.
6. Verify type checking, tests, build, route manifest, health endpoint, and a real browser-visible main flow through the running preview.

## Project structure

- `client/src/pages/` — route views and task workspace.
- `client/src/components/curialy/` — shared shell and product components.
- `client/src/lib/` — browser persistence and typed task helpers.
- `shared/skills.ts` — provider-independent skill registry and selection metadata.
- `server/ai/` — server-only provider adapter and task execution helpers.
- `server/routers.ts` — validated tRPC entry points.
- `public/manus-routes.json` — page route manifest.
- `drizzle/` — starter auth schema retained; durable task tables remain a follow-up once user identity/ownership is wired.

## Scope boundaries

Gemini, grounded search, and Live voice remain modular and configuration-aware. The UI exposes truthful missing-configuration and fallback states rather than fabricating citations, audio sessions, or background execution. Browser-local tasks are explicitly marked local demo persistence until authenticated database ownership is connected.
