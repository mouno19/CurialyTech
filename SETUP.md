# Curialy AI setup

Curialy AI is a React/Express/tRPC/Drizzle project. Run `pnpm dev` for the server-backed preview, `pnpm check` for TypeScript validation, `pnpm test` for the test suite, and `pnpm build` for the production bundle.

The task provider is server-only. The managed Webdev runtime supplies `MANUS_API_URL` and `MANUS_API_KEY`; the browser never receives those values. When they are absent, Curialy keeps the task prompt, selected skills, and plan locally and shows a clear configuration limitation instead of pretending a model ran.

Think mode maps to the documented Gemini-compatible `thinking` request extension when a compatible model is selected. The current first slice does not fabricate Google Search grounding or Live voice sessions. Web Search and voice controls are still surfaced with explicit configuration-aware states so they can be connected to the official provider contracts without changing the UI architecture.

Task history and preferences use browser-local persistence in this first slice. This is labeled as local demo persistence in the UI; durable authenticated task tables and ownership migration should be added before treating the application as multi-user production software. The starter users table and OAuth flow remain intact.
