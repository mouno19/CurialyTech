// Copy for the public homepage. Everything here describes what Curialy really does; the
// workspace window is labelled as a sample run, and there are no invented customers or figures.

export const NAV_LINKS = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#workspace", label: "Workspace" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#principles", label: "Principles" },
  { href: "#pricing", label: "Pricing" },
];

export const COMPOSER_EXAMPLES = [
  "Build a landing page with a pricing table and a signup form, and make sure the build passes",
  "Find out why the checkout test fails and fix it with a regression test",
  "Migrate this Express API to TypeScript, one module at a time",
  "Explain how auth works in this repo, with file-and-line references",
];

export const COMPOSER_SUGGESTIONS = [
  { label: "Build an app", prompt: "Build an internal dashboard for weekly signups with charts, filters and CSV export" },
  { label: "Fix a bug", prompt: "TypeError in OrderSummary when the cart is empty: reproduce it, fix it and add a regression test" },
  { label: "Write tests", prompt: "Raise the test coverage of src/billing without changing behaviour, and run the whole suite" },
  { label: "Explain this repo", prompt: "Give me a guided tour of this repository: architecture, data flow and where to start" },
];

/** What happens once a task is handed over (an explanation, not a progress bar). */
export const NEXT_STEPS = [
  { label: "Reads the task and the code", detail: "files, docs and anything you attach" },
  { label: "Plans the work", detail: "in Dev Team mode an Architect writes the plan" },
  { label: "Builds in its own sandbox", detail: "a real terminal, browser and runtime" },
  { label: "Verifies before it hands over", detail: "build, tests and checks, fixing what fails" },
];

export type StackItem = { name: string; style: "sans" | "serif" | "mono" | "light" | "wide" };

/** What it writes and runs in its sandbox (the marquee). */
export const STACK: StackItem[] = [
  { name: "TypeScript", style: "sans" },
  { name: "React", style: "serif" },
  { name: "NODE.JS", style: "mono" },
  { name: "python", style: "light" },
  { name: "Vite", style: "serif" },
  { name: "EXPRESS", style: "wide" },
  { name: "SQL", style: "mono" },
  { name: "html & css", style: "light" },
  { name: "Vitest", style: "serif" },
  { name: "bash", style: "mono" },
  { name: "PYTEST", style: "wide" },
  { name: "GitHub", style: "sans" },
];

export const CAPABILITIES = [
  {
    verb: "Plans",
    title: "Turns a vague ask into a reviewable plan.",
    body: "It reads the repository, the task and the files you attach, then lays out the steps. In Dev Team mode an Architect writes the plan and a Reviewer holds the work to it.",
    artifact: "plan · 6 steps · 2 open questions",
  },
  {
    verb: "Codes",
    title: "Writes code that fits the codebase.",
    body: "It follows the conventions already in the repository and keeps changes small enough to review. Every edit it makes shows up as a diff, and every command it runs is on the record.",
    artifact: "+482 −37 across 14 files",
  },
  {
    verb: "Debugs",
    title: "Reads the stack trace so you don't have to.",
    body: "It reproduces the failure in its sandbox, finds the cause and fixes the root, then runs the check again to prove it.",
    artifact: "TypeError traced → cart.ts:88",
  },
  {
    verb: "Tests",
    title: "Proves it works before it hands over.",
    body: "It runs your build and your tests, retries with a fix when they fail, and can open the result in a real browser to screenshot it.",
    artifact: "build ✓ · tests ✓ · screenshot",
  },
  {
    verb: "Previews",
    title: "Shows you the running app.",
    body: "It starts what it built and opens it in a real browser inside the workspace, with a full-page screenshot on the record, so you see the result before you read the code.",
    artifact: "preview · screenshot · console clean",
  },
];

export const STEPS = [
  {
    title: "You describe the outcome.",
    body: "Write the task the way you'd brief a senior engineer. Attach files, paste a stack trace or point it at one of your GitHub repositories.",
    snippet: "“Add checkout. Keep discount codes working.”",
  },
  {
    title: "It investigates first.",
    body: "It reads the code, the docs and whatever you attached before it changes anything, and says what it assumed.",
    snippet: "reading · 412 files · 3 docs",
  },
  {
    title: "It plans in the open.",
    body: "The plan streams into the task as it forms. In Dev Team mode an Architect writes it, an Engineer builds it and a Reviewer checks it.",
    snippet: "plan ── 5 steps",
  },
  {
    title: "It builds in its own workspace.",
    body: "Every task gets a sandbox of its own with a real terminal, a real browser and a real runtime, so tasks never see each other's files. It writes, runs, breaks and fixes on its own.",
    snippet: "$ npm test  ✓ 14 passed",
  },
  {
    title: "It verifies the result.",
    body: "Builds, tests and checks run before anything reaches you. A run that fails says so; nothing is dressed up as done.",
    snippet: "⚑ 1 issue: refund flow has no test",
  },
  {
    title: "Review it, then merge.",
    body: "Read the answer, the diff and the test output, and open the running app in the Preview tab. On a repository you linked it has already pushed a branch and opened a pull request for you to review and merge; otherwise export the project to GitHub.",
    snippet: "pull request · ready for review",
  },
];

/** The sample run in the workspace window. */
export const SAMPLE_TASK = "Add checkout to the storefront";

export const TASK_PROGRESS = [
  { label: "Read the repo and the issue", time: "0:42", state: "done" },
  { label: "Plan written by the Architect", time: "1:10", state: "done" },
  { label: "Install the payments SDK", time: "1:31", state: "done" },
  { label: "Implement createSession()", time: "3:58", state: "done" },
  { label: "Fix the failing discount test", time: "running", state: "active" },
  { label: "Ready for your review", time: "—", state: "pending" },
] as const;

export const DIFF_LINES: { kind: "ctx" | "add" | "del"; text: string }[] = [
  { kind: "ctx", text: 'import { payments } from "@storefront/payments";' },
  { kind: "add", text: 'import { getCart, applyDiscount } from "../cart";' },
  { kind: "ctx", text: "" },
  { kind: "ctx", text: "export async function createSession(userId: string) {" },
  { kind: "del", text: "  const total = cart.total;" },
  { kind: "add", text: "  const cart = await getCart(userId);" },
  { kind: "add", text: "  const items = cart.items.map(toLineItem);" },
  { kind: "add", text: "  const lineItems = applyDiscount(items, cart.code);" },
  { kind: "ctx", text: "  return payments.sessions.create({" },
  { kind: "ctx", text: '    mode: "payment",' },
  { kind: "add", text: "    lineItems," },
  { kind: "add", text: "    successUrl: `${origin}/thank-you`," },
  { kind: "ctx", text: "  });" },
  { kind: "ctx", text: "}" },
];

export const TERMINAL_LINES: { tone: "cmd" | "out" | "ok" | "err" | "agent"; text: string }[] = [
  { tone: "cmd", text: "$ npm install @storefront/payments" },
  { tone: "out", text: "  added 3 packages in 2.1s" },
  { tone: "cmd", text: "$ npm test checkout" },
  { tone: "ok", text: "  ✓ creates a session from cart line items (42ms)" },
  { tone: "ok", text: "  ✓ rejects empty carts (8ms)" },
  { tone: "err", text: "  ✗ applies discount codes: expected 16200, got 18000" },
  { tone: "agent", text: "  ● curialy: discount applied after tax, moving it before tax in cart.ts:88" },
  { tone: "cmd", text: "$ npm test checkout" },
  { tone: "ok", text: "  ✓ 14 passed · 0 failed · 1.9s" },
  { tone: "agent", text: "  ● curialy: opening the preview in the browser to check the checkout page" },
  { tone: "ok", text: "  ▲ preview running · screenshot attached · ready for review" },
];

/** The principles ledger: facts about how the workspace behaves. */
export const PRINCIPLES = [
  { value: "1:1", label: "workspace per task, with its own folder and command log" },
  { value: "0", label: "repositories made public without your explicit confirmation" },
  // No refill time here: the window is the operator's setting (the pricing section shows the live one).
  { value: "$0", label: "to start: sign in with GitHub, no card needed" },
  { value: "Every", label: "step of every run on the record: plan, commands, files, results" },
];

export const PROMISES = [
  {
    title: "Cancel means stop.",
    body: "A cancelled run stops where it is. It never publishes, pushes or deploys on the way out, and the files written so far are kept.",
  },
  {
    title: "Failed means failed.",
    body: "A run that fails is shown as failed, with the error and what still happened. Nothing is labelled done that isn't.",
  },
];

export const FOOTER_WORKSPACE = [
  { href: "/", label: "Dashboard" },
  { href: "/tasks", label: "Live tasks" },
  { href: "/sandbox", label: "Code sandbox" },
  { href: "/media", label: "Media vault" },
  { href: "/integrations", label: "Integrations" },
];
