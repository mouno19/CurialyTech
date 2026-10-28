// Starter tasks: the homepage's "Use cases" and the dashboard's starter tasks share this list.
// Every outcome is something the agent really does today (no invented figures or customers).

export type StarterTask = {
  id: string;
  tab: string;
  headline: string;
  prompt: string;
  outcomes: string[];
  /** What you get back, in a few words. */
  deliverable: string;
  /** Dev Team mode suits larger builds; questions stay solo. */
  team?: boolean;
};

export const STARTER_TASKS: StarterTask[] = [
  {
    id: "build",
    tab: "Build apps",
    headline: "From a paragraph to a working product.",
    prompt: "Build an internal dashboard that shows weekly signups from a CSV file, with charts, filters and a CSV export. Use React and Vite, and make sure the build and tests pass.",
    outcomes: [
      "Scaffolds the frontend, API and data model in the stack you name",
      "Runs the build and the tests, and fixes what fails",
      "Opens the running app in a real browser and checks it, with a screenshot",
    ],
    deliverable: "Workspace files · a preview · GitHub export",
    team: true,
  },
  {
    id: "fix",
    tab: "Fix bugs",
    headline: "Paste the stack trace. Go get coffee.",
    prompt: "TypeError: cannot read 'id' of undefined in OrderSummary when the cart is empty. Reproduce it, fix the cause and add a regression test.",
    outcomes: [
      "Reproduces the failure in its workspace",
      "Traces the cause through the code instead of patching the symptom",
      "Ships the fix together with a regression test",
    ],
    deliverable: "A verified fix · a regression test · a diff to review",
  },
  {
    id: "understand",
    tab: "Understand codebases",
    headline: "A guided tour of code nobody remembers writing.",
    prompt: "Explain how a payment flows through this repository, from the checkout form to the database, with file-and-line references.",
    outcomes: [
      "Architecture overviews and data-flow walkthroughs",
      "Answers that cite the files and lines they come from",
      "Onboarding notes you can keep in the repository",
    ],
    deliverable: "A written answer · file references · notes",
  },
  {
    id: "research",
    tab: "Research the web",
    headline: "It reads the docs, then does the work.",
    prompt: "Compare three charting libraries for a React dashboard: read their docs and licences, then prototype the best fit with a sample chart.",
    outcomes: [
      "Reads documentation and pages with a real browser",
      "Takes screenshots and checks pages visually",
      "Turns what it found into working code",
    ],
    deliverable: "A recommendation · sources · a prototype",
  },
];
