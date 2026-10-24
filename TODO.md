# Curialy AI outcomes

## Responsive Curialy dashboard

- [ ] The dashboard uses the Curialy brand and the dark reference composition with a persistent sidebar, top controls, central workspace, and right-side Recent Tasks and Workspace Activity panels.
- [ ] Sidebar navigation includes New Task, Discover, My Tasks, Skills, Library, Creations, Automations, Integrations, and Settings, with a violet active state and responsive drawer behavior.
- [ ] The header exposes model, Think, Web Search, microphone, keyboard shortcut, integration health, and account controls whose visible states reflect application state.
- [ ] The central composer includes the requested heading, supporting text, placeholder, multiline input, attach and voice controls, synchronized Think and Web Search toggles, Start Task action, Enter/Shift+Enter behavior, and failure/loading states.
- [ ] Quick Actions launch meaningful composer templates, and the six Curialy Skills cards display registry-backed availability.

## Skills and task workflow

- [ ] A typed registry defines Web Research, Coding, Deep Thinking, Data Analysis, Writing, and Document Analysis with descriptions, categories, versions, availability, tool requirements, and usage metadata.
- [ ] `/skills` supports search, category filtering, and truthful enable/disable/configuration states.
- [ ] Submitting a task validates the request, selects relevant enabled skills, records a task plan and status, and presents a final response or an honest provider-configuration error without inventing progress.
- [ ] Task detail supports status, instruction, plan, skills used, activity, response, copy, retry, follow-up, and cancellation affordances where applicable.
- [ ] Local demo persistence keeps real browser-created tasks and preferences separate from fabricated sample content.

## Supporting views and safety

- [ ] Discover, My Tasks, Library, Creations, Automations, Integrations, and Settings use the same design system and meaningful empty/configuration states.
- [ ] Server-only model calls use validated input, bounded request size, and no arbitrary shell execution; permanent credentials never enter browser bundles.
- [ ] Route manifest, environment example, setup notes, and deployment guidance are present.

## Verification evidence

- [ ] `pnpm check` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.
- [ ] Preview server responds on `/api/health` and `/manus-routes.json` with valid JSON.
- [ ] Main dashboard flow and responsive layout are exercised in the running preview.
- [ ] Credential-dependent Gemini/search/voice behavior is labeled verified or unverified based on actual configuration checks.
