import type Anthropic from "@anthropic-ai/sdk";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { getModel, teamCapable, type ModelSpec, type TeamPlan, type TeamReview, type TeamRole } from "@shared/agent";
import { changedSince, workspaceManifest } from "./artifacts";
import type { Emit } from "./bus";
import { AGENT_SYSTEM, describeError, emitText, forkContext, runAgentLoop, type RunContext, type VirtualTool } from "./runner";
import { getTeamState, saveTeamState, settleTeamWrites } from "./store";

// Dev Team mode: three agents on one workspace.
//   Architect (read-only) explores and submits a plan.
//   Engineer (full coding tools) implements it, with the usual verification/self-healing.
//   Reviewer/QA (read-only + tests) reviews the actual diff and submits a verdict.
// Requested changes go back to the Engineer for up to MAX_REVIEW_ROUNDS. Publishing (push, PR,
// deploy) is only possible after approval. Every event a member produces is tagged with its role
// so the UI can show who is doing what in real time.

const MAX_REVIEW_ROUNDS = 3;
const PUBLISH_TURNS = 12;

type TeamState = { architect: Anthropic.MessageParam[]; engineer: Anthropic.MessageParam[]; reviewer: Anthropic.MessageParam[]; cycles: number; plans: TeamPlan[]; reviews: TeamReview[] };

const READ_TOOLS = ["list_files", "read_file", "search_files", "web_fetch", "browse", "browser_click", "browser_type", "browser_scroll", "browser_extract", "browser_screenshot", "browser_close"];
// Architect and Reviewer run commands read-only: whatever a command changes in the source is reverted
// (RunContext.readOnly). Cloning the task's repository is setup, not an edit, so the Architect may.
const ROLE_TOOLS: Record<TeamRole, string[]> = {
  architect: [...READ_TOOLS, "run_command", "github_list_repos", "github_get_repo", "github_clone_to_workspace", "delegate_research"],
  engineer: [...READ_TOOLS, "run_command", "write_file", "edit_file", "delete_file", "update_plan", "attach_files", "test_preview_visual", "transcribe_audio", "generate_speech", "github_list_repos", "github_get_repo", "github_clone_to_workspace"],
  reviewer: [...READ_TOOLS, "run_command", "test_preview_visual"],
};
/** Only after the Reviewer approves. */
// Previews are not part of team publishing: they start only from the user's confirmed Deploy action.
const PUBLISH_TOOLS = ["github_commit_and_push", "github_create_pr"];
const PUBLISH_INTENT = /\b(push|commit|pull request|PR|merge|deploy|publish|ship|release|live preview|github)\b/i;

const planSchema = z.object({
  summary: z.string().min(10).max(4000),
  steps: z.array(z.object({ title: z.string().min(3).max(300), detail: z.string().max(4000).default(""), acceptance: z.string().max(1500).default("") })).min(1).max(20),
  risks: z.array(z.string().max(600)).max(12).default([]),
  test_plan: z.string().max(3000).default(""),
});

const reviewSchema = z.object({
  verdict: z.enum(["approve", "request_changes"]),
  summary: z.string().min(5).max(4000),
  issues: z.array(z.object({ severity: z.enum(["blocker", "major", "minor"]), file: z.string().max(400).optional(), description: z.string().min(5).max(2000), suggestion: z.string().max(2000).default("") })).max(30).default([]),
  tests_run: z.array(z.object({ command: z.string().max(500), result: z.string().max(1000) })).max(20).default([]),
});

const SUBMIT_PLAN: VirtualTool = {
  definition: {
    name: "submit_plan",
    description: "Hand your implementation plan to the Engineer. Call exactly once, when your investigation is complete.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What will be built/changed and the approach, in a few sentences" },
        steps: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string", description: "Files, functions and concrete approach" }, acceptance: { type: "string", description: "How to tell this step is done" } }, required: ["title", "detail", "acceptance"] } },
        risks: { type: "array", items: { type: "string" } },
        test_plan: { type: "string", description: "Commands/checks that prove the whole change works" },
      },
      required: ["summary", "steps", "test_plan"],
    },
  },
  schema: planSchema,
  summary: (plan: TeamPlan) => `${plan.steps.length}-step plan`,
};

const SUBMIT_REVIEW: VirtualTool = {
  definition: {
    name: "submit_review",
    description: "Hand your review verdict to the team. Call exactly once, after reviewing the changes and running the checks.",
    input_schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["approve", "request_changes"] },
        summary: { type: "string" },
        issues: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["blocker", "major", "minor"] }, file: { type: "string" }, description: { type: "string" }, suggestion: { type: "string" } }, required: ["severity", "description", "suggestion"] } },
        tests_run: { type: "array", items: { type: "object", properties: { command: { type: "string" }, result: { type: "string" } }, required: ["command", "result"] } },
      },
      required: ["verdict", "summary", "issues", "tests_run"],
    },
  },
  schema: reviewSchema,
  summary: (review: TeamReview) => (review.verdict === "approve" ? "Approved" : `Changes requested (${review.issues.length})`),
};

const TEAM_INTRO = "You are part of a three-member Curialy dev team: the Architect plans, the Engineer implements, the Reviewer reviews and tests. You share one workspace.";

const ARCHITECT_SYSTEM = `${TEAM_INTRO} You are the Architect.

Investigate the workspace and the request (list_files, read_file, search_files; run_command only for read-only inspection such as versions, configs or git log; web tools for documentation). Do NOT create, edit or delete files and do not install anything.

Then call submit_plan exactly once with a plan the Engineer can follow without guessing:
- summary: the approach in a few sentences;
- steps: ordered, each with concrete detail (files, functions, data shapes, libraries) and acceptance criteria;
- risks: pitfalls and edge cases to handle;
- test_plan: the exact commands or checks that prove it works (include setting up a test script if the project has none).
Keep the plan proportional to the request: one to three steps for small changes. Do not write the implementation.`;

const ENGINEER_SYSTEM = `${AGENT_SYSTEM}

${TEAM_INTRO} You are the Engineer. Implement the Architect's plan fully and keep update_plan statuses current as you go. Run the test plan yourself before you finish. Pushing, pull requests and deploys happen after the Reviewer approves, when you will be given those tools; do not try to publish before then. When the Reviewer reports issues, fix every blocker and major issue (address minor ones or say why not), re-run the checks, and finish with a concise summary of what changed and how you verified it.`;

const REVIEWER_SYSTEM = `${TEAM_INTRO} You are the Reviewer and QA. You cannot modify source files (commands may build and test, but any source change they make is reverted).

Review the Engineer's changes (the diff is provided; read surrounding code as needed) against the user's request and the plan's acceptance criteria: correctness, edge cases, error handling, security, and consistency with the codebase. Run the test plan and any other relevant checks yourself with run_command; for user interfaces, use test_preview_visual and look at the screenshot.

Then call submit_review exactly once. Approve only when there are no blocker or major issues and the checks pass. Otherwise request_changes with specific, actionable issues (file, what is wrong, how to fix it). Do not nitpick style or ask for unrelated work.`;

const effortFor: Record<TeamRole, "low" | "medium" | "high"> = { architect: "high", engineer: "medium", reviewer: "medium" };

/** Engineer: the task's chosen model when it can run the team loop; otherwise Sonnet 5.5. */
function roleModels(taskSpec: ModelSpec): Record<TeamRole, ModelSpec> {
  const engineer = teamCapable(taskSpec) ? taskSpec : getModel("claude-sonnet-5-5")!;
  return { architect: getModel("claude-opus-5-5")!, engineer, reviewer: reviewerFor(engineer) };
}

/** The Reviewer is a different model from the Engineer, for an independent second opinion. */
const reviewerFor = (engineer: ModelSpec) => (engineer.id === "claude-opus-5" ? getModel("claude-opus-5-5")! : getModel("claude-opus-5")!);

const bullet = (items: string[]) => items.map(item => `- ${item}`).join("\n");

export function planMarkdown(plan: TeamPlan) {
  return [
    plan.summary,
    "",
    ...plan.steps.map((step, index) => `${index + 1}. **${step.title}**${step.detail ? `\n   ${step.detail.replace(/\n/g, "\n   ")}` : ""}${step.acceptance ? `\n   _Done when:_ ${step.acceptance}` : ""}`),
    ...(plan.risks.length ? ["", "**Risks**", bullet(plan.risks)] : []),
    ...(plan.test_plan ? ["", "**Test plan**", plan.test_plan] : []),
  ].join("\n");
}

export function reviewMarkdown(review: TeamReview) {
  const order = { blocker: 0, major: 1, minor: 2 } as const;
  const issues = [...review.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return [
    review.summary,
    ...(issues.length ? ["", "**Issues**", ...issues.map(issue => `- **${issue.severity}**${issue.file ? ` \`${issue.file}\`` : ""}: ${issue.description}${issue.suggestion ? `\n  _Fix:_ ${issue.suggestion}` : ""}`)] : []),
    ...(review.tests_run.length ? ["", "**Checks run**", ...review.tests_run.map(test => `- \`${test.command}\`: ${test.result}`)] : []),
  ].join("\n");
}

/** Unified diff of what the Engineer changed in this cycle, capped so the Reviewer's context stays sane. */
function diffDigest(changes: Map<string, { before: string; after: string; kind: string }>, byCommand: Set<string>, cap = 60_000) {
  let out = "";
  for (const [file, change] of Array.from(changes.entries())) {
    let patch = createTwoFilesPatch(`a/${file}`, `b/${file}`, change.before, change.after, "", "", { context: 3 });
    if (patch.length > 12_000) patch = `${patch.slice(0, 12_000)}\n… [diff of ${file} truncated; read the file for the rest]\n`;
    if (out.length + patch.length > cap) { out += `\n… [${changes.size} files changed in total; remaining diffs omitted, read the files directly]\n`; break; }
    out += `${patch}\n`;
  }
  const other = Array.from(byCommand).filter(file => !changes.has(file));
  if (other.length) out += `\nAlso created or changed by the Engineer's commands (no diff recorded; read them directly):\n${other.slice(0, 60).map(file => `- ${file}`).join("\n")}${other.length > 60 ? `\n- … and ${other.length - 60} more` : ""}\n`;
  return out || "(no file changes recorded)";
}

/** Append a user turn, merging into a trailing user turn (e.g. tool results) so roles keep alternating. */
function pushUser(history: Anthropic.MessageParam[], content: string | Anthropic.ContentBlockParam[]) {
  const blocks: Anthropic.ContentBlockParam[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
  const last = history[history.length - 1];
  if (last?.role === "user") last.content = [...(typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content), ...blocks];
  else history.push({ role: "user", content: blocks });
}

/** Fail closed: a Reviewer that never submits a verdict has not approved; its prose goes back as feedback. */
function unverifiedReview(text: string): TeamReview {
  return {
    verdict: "request_changes",
    summary: "The Reviewer did not submit a structured verdict, so the changes are not approved.",
    issues: text ? [{ severity: "major", description: text.slice(0, 2000), suggestion: "" }] : [],
    tests_run: [],
  };
}

/** The user's latest request as content blocks (keeps attached images). */
function requestBlocks(conversation: Anthropic.MessageParam[]): Anthropic.ContentBlockParam[] {
  const last = [...conversation].reverse().find(message => message.role === "user");
  if (!last) return [{ type: "text", text: "(no request)" }];
  return typeof last.content === "string" ? [{ type: "text", text: last.content }] : (last.content as Anthropic.ContentBlockParam[]);
}

const requestText = (blocks: Anthropic.ContentBlockParam[]) => blocks.filter((block): block is Anthropic.TextBlockParam => block.type === "text").map(block => block.text).join("\n");

export async function runTeam(ctx: RunContext, conversation: Anthropic.MessageParam[]): Promise<string> {
  const state: TeamState = (await getTeamState<TeamState>(ctx.taskId)) ?? { architect: [], engineer: [], reviewer: [], cycles: 0, plans: [], reviews: [] };
  state.cycles++;
  const cycle = state.cycles;
  const save = () => { saveTeamState(ctx.taskId, state, ctx.runToken); };
  const models = roleModels(ctx.spec);
  const request = requestBlocks(conversation);
  const followUp = cycle > 1 ? `This is follow-up request #${cycle - 1} on the same project.\n\n` : "";

  // The Engineer's file changes for this cycle (first "before", last "after" per file), plus files its
  // commands created or changed (found by diffing the workspace around each Engineer run).
  const changes = new Map<string, { before: string; after: string; kind: string }>();
  const byCommand = new Set<string>();
  const parent: RunContext = {
    ...ctx,
    emit: (body => {
      if (body.type === "file_change" && (body as { agent?: string }).agent === "engineer") {
        const previous = changes.get(body.path);
        changes.set(body.path, { before: previous?.before ?? body.before, after: body.after, kind: previous && previous.kind === "create" ? "create" : body.kind });
      }
      ctx.emit(body);
    }) as Emit,
  };
  const status = (role: TeamRole, value: "waiting" | "working" | "done" | "failed", activity: string) =>
    ctx.emit({ type: "team_agent", role, status: value, model: models[role].id, activity });
  // Each loop gets its own run id so block/call ids never repeat across rounds.
  const member = (role: TeamRole, history: Anthropic.MessageParam[], runId: string, opts: { virtualTools?: Record<string, VirtualTool>; tools?: string[] } = {}) => forkContext(parent, {
    role, spec: models[role], effort: role === "engineer" ? ctx.effort : effortFor[role],
    system: role === "architect" ? ARCHITECT_SYSTEM : role === "engineer" ? ENGINEER_SYSTEM : REVIEWER_SYSTEM,
    conversation: history, persist: save, allowedTools: new Set(opts.tools ?? ROLE_TOOLS[role]), virtualTools: opts.virtualTools,
    readOnly: role !== "engineer", runId: `${ctx.runId}-${runId}`,
  });
  const engineerRun = async (runId: string, opts?: { tools?: string[]; verify?: boolean; maxTurns?: number }) => {
    const before = workspaceManifest(ctx.root);
    const fork = member("engineer", state.engineer, runId, { tools: opts?.tools });
    try {
      return await runAgentLoop(fork, state.engineer, { verify: opts?.verify ?? true, maxTurns: opts?.maxTurns });
    } finally {
      for (const file of changedSince(before, workspaceManifest(ctx.root))) byCommand.add(file);
      // Self-healing may have escalated or failed over the Engineer: keep that model for later
      // rounds and keep the Reviewer independent of whoever actually wrote the code.
      if (fork.spec.id !== models.engineer.id) {
        models.engineer = fork.spec;
        models.reviewer = reviewerFor(fork.spec);
      }
    }
  };

  let active: TeamRole = "architect";
  const statuses: Partial<Record<TeamRole, string>> = {};
  const track = (role: TeamRole, value: "waiting" | "working" | "done" | "failed", activity: string) => {
    statuses[role] = value;
    if (value === "working") active = role;
    status(role, value, activity);
  };

  try {
    for (const role of ["architect", "engineer", "reviewer"] as TeamRole[]) track(role, "waiting", "Waiting for its turn");
    if (models.engineer.id !== ctx.spec.id) ctx.emit({ type: "notice", level: "info", message: `Dev Team members share one conversation format, so the Engineer uses ${models.engineer.label} instead of ${ctx.spec.label}.` });

    // ---- 1. Architect: plan ----
    ctx.phases.advance("planning", "Architect is planning");
    track("architect", "working", "Investigating the workspace and the request");
    pushUser(state.architect, [...request, { type: "text", text: `${followUp}Plan this request for the team, then call submit_plan.` }]);
    save();
    const planned = await runAgentLoop(member("architect", state.architect, "a", { virtualTools: { submit_plan: SUBMIT_PLAN } }), state.architect, { verify: false, terminal: "submit_plan", maxTurns: 30 });
    const plan: TeamPlan = planned.terminal
      ? (planned.terminal as unknown as TeamPlan)
      : { summary: planned.text || "Implement the request as described.", steps: [{ title: "Implement the request", detail: requestText(request).slice(0, 2000), acceptance: "The request is fulfilled and checks pass" }], risks: [], test_plan: "" };
    state.plans.push(plan);
    save();
    track("architect", "done", `Plan ready: ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}`);
    ctx.emit({ type: "plan", steps: plan.steps.map(step => ({ title: step.title, status: "pending" })) });
    ctx.emit({ type: "handoff", from: "architect", to: "engineer", kind: "plan", title: `Plan · ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}`, content: planMarkdown(plan) });

    // ---- 2. Engineer: implement ----
    ctx.phases.advance("implementation", "Engineer is implementing");
    track("engineer", "working", "Implementing the plan");
    pushUser(state.engineer, [...request, { type: "text", text: `${followUp}The Architect's plan:\n\n${planMarkdown(plan)}\n\nImplement it now. Keep the step statuses current with update_plan (same step titles).` }]);
    save();
    let built = await engineerRun("e0");
    track("engineer", "waiting", "Waiting for review");

    // ---- 3. Reviewer: review and test, with fix rounds ----
    let review: TeamReview | null = null;
    let rounds = 0;
    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      rounds = round;
      ctx.phases.set("verification", "active", `Review round ${round}/${MAX_REVIEW_ROUNDS}`);
      track("reviewer", "working", `Reviewing round ${round}`);
      pushUser(state.reviewer, [
        ...(round === 1 ? request : [{ type: "text" as const, text: "The Engineer has addressed your previous review." }]),
        {
          type: "text",
          text: `${round === 1 ? `${followUp}The plan:\n\n${planMarkdown(plan)}\n\n` : ""}The Engineer's summary:\n\n${built.text || "(no summary)"}\n\nChanges${round === 1 ? "" : " so far"} in this ${cycle > 1 ? "follow-up" : "task"} (unified diff):\n\n${diffDigest(changes, byCommand)}\n\nReview the changes and run the checks, then call submit_review.`,
        },
      ]);
      save();
      const reviewed = await runAgentLoop(member("reviewer", state.reviewer, `r${round}`, { virtualTools: { submit_review: SUBMIT_REVIEW } }), state.reviewer, { verify: false, terminal: "submit_review", maxTurns: 30 });
      review = reviewed.terminal ? (reviewed.terminal as unknown as TeamReview) : unverifiedReview(reviewed.text);
      state.reviews.push(review);
      save();
      const blocking = review.issues.filter(issue => issue.severity !== "minor").length;
      track("reviewer", review.verdict === "approve" ? "done" : "waiting", review.verdict === "approve" ? `Approved in round ${round}` : `Requested ${review.issues.length} change(s)`);
      ctx.emit({
        type: "handoff", from: "reviewer", to: review.verdict === "approve" ? "user" : "engineer", kind: "review", round,
        title: review.verdict === "approve" ? `Approved · round ${round}` : reviewed.terminal ? `Changes requested · ${blocking} blocking, ${review.issues.length - blocking} minor` : "No verdict submitted · not approved",
        content: reviewMarkdown(review),
      });
      if (review.verdict === "approve" || round === MAX_REVIEW_ROUNDS) break;

      track("engineer", "working", `Fixing review round ${round}`);
      ctx.phases.set("verification", "active", `Engineer fixing round ${round} feedback`);
      pushUser(state.engineer, `The Reviewer requested changes (round ${round}/${MAX_REVIEW_ROUNDS}):\n\n${reviewMarkdown(review)}\n\nFix every blocker and major issue, re-run the checks, then summarise what you changed.`);
      save();
      built = await engineerRun(`e${round}`);
      track("engineer", "waiting", "Waiting for re-review");
    }

    const approved = review?.verdict === "approve";
    ctx.outcome.review = { verdict: review?.verdict ?? "none", rounds };
    if (!approved) track("reviewer", "done", "Open items remain");

    // ---- 4. Publish (only after approval, and only when the request asks for it) ----
    const wantsPublish = PUBLISH_INTENT.test(`${requestText(request)}\n${plan.summary}\n${plan.steps.map(step => step.title).join("\n")}`);
    let published = "";
    if (wantsPublish && approved) {
      track("engineer", "working", "Publishing the approved changes");
      pushUser(state.engineer, "The Reviewer approved your changes. If the user's request asked for publishing to GitHub (committing/pushing, or opening a pull request), do exactly that now and report the links. Do not change any files. You cannot deploy previews: if the user asked for one, tell them to use the Deploy action. If nothing needs publishing, say so and stop.");
      save();
      try {
        delete ctx.outcome.publish;
        published = (await engineerRun("p", { tools: [...ROLE_TOOLS.engineer, ...PUBLISH_TOOLS], verify: false, maxTurns: PUBLISH_TURNS })).text;
        // trackedTool recorded done/failed for each push or PR; none called means nothing was published.
        ctx.outcome.publish ??= "not_requested";
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        ctx.outcome.publish = "failed";
        published = `Publishing did not complete: ${describeError(error)}`;
      }
    } else if (wantsPublish) {
      ctx.outcome.publish = "blocked_unapproved";
      published = "Not published: the Reviewer did not approve the changes, so nothing was pushed or deployed.";
    } else {
      ctx.outcome.publish = "not_requested";
    }
    track("engineer", "done", approved ? "Changes approved" : "Finished with open review items");

    // ---- 5. Report ----
    const outstanding = !approved && review ? review.issues.filter(issue => issue.severity !== "minor") : [];
    const report = [
      `**Dev Team result: ${approved ? `approved by the Reviewer after ${rounds} round${rounds === 1 ? "" : "s"}` : `not approved after ${rounds} review round${rounds === 1 ? "" : "s"}`}.**`,
      "",
      `**Plan (Architect):** ${plan.summary}`,
      "",
      "**Implementation (Engineer):**",
      built.text || "(no summary)",
      "",
      `**Review (Reviewer):** ${review?.summary ?? "No review."}`,
      ...(outstanding.length ? ["", "**Still open:**", ...outstanding.map(issue => `- **${issue.severity}**${issue.file ? ` \`${issue.file}\`` : ""}: ${issue.description}`)] : []),
      ...(review?.tests_run.length ? ["", "**Checks run by the Reviewer:**", ...review.tests_run.map(test => `- \`${test.command}\`: ${test.result}`)] : []),
      ...(published ? ["", "**Publishing:**", published] : []),
    ].join("\n");
    ctx.emit({ type: "handoff", from: "reviewer", to: "user", kind: "report", title: approved ? (ctx.outcome.publish === "failed" ? "Team report · approved, publishing failed" : "Team report · approved") : "Team report · open items", content: report });
    await settleTeamWrites(ctx.taskId);
    async function* once() { yield report; }
    return emitText(ctx, `${ctx.runId}-team-report`, once());
  } catch (error) {
    // Show where the team stopped; runTask records the failure itself.
    // Name the stop truthfully: a restart is not a cancel.
    const stop = ctx.signal.aborted ? (ctx.signal.reason as { reason?: string } | undefined)?.reason ?? "user" : null;
    const label = stop === "shutdown" ? "Interrupted: the server restarted" : stop ? "Cancelled" : "Stopped by an error";
    status(active, "failed", label);
    for (const role of ["architect", "engineer", "reviewer"] as TeamRole[]) {
      if (role !== active && (statuses[role] === "waiting" || statuses[role] === "working")) status(role, "failed", stop ? label : "Stopped: the team run failed");
    }
    await settleTeamWrites(ctx.taskId).catch(() => undefined);
    throw error;
  }
}
