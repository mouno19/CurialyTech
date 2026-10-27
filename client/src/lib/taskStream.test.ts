import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentEventBody } from "@shared/agent";
import {
  conversationRuns, freshestStatus, initialInspectorTab, initialStreamState, isVendorUrl, latestRun, maskPreviewToken, mergeDeployment, reconnectDelay,
  resolveAnswer, runEffects, runError, scrubText, streamReducer, type ItemOf, type StreamState,
} from "./taskStream";

const T0 = Date.parse("2026-10-27T10:00:00.000Z");
let clock = 0;
const ev = (seq: number, body: AgentEventBody, extra: Partial<AgentEvent> = {}): AgentEvent => ({ ...body, seq, ts: new Date(T0 + seq * 1000).toISOString(), ...extra }) as AgentEvent;
const feed = (state: StreamState, events: AgentEvent[]) => streamReducer(state, { type: "events", events, at: T0 + 100_000 + ++clock });
const run = (events: AgentEvent[]) => feed(initialStreamState(), events);
const items = <K extends ItemOf<"text">["kind"] | string>(state: StreamState, kind: K) => state.items.filter(item => item.kind === kind);
const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const DEP = "33333333-3333-4333-8333-333333333333";

const startOf = (seq: number, runId = RUN_A, trigger: "prompt" | "follow_up" | "retry" | "deploy" = "prompt", attempt = 1) => ev(seq, { type: "run_start", runId, attempt, trigger });

describe("dedupe", () => {
  it("never doubles text or cards for duplicates inside one batch", () => {
    const text = ev(3, { type: "text_delta", blockId: "b1", text: "Hello" });
    const state = run([startOf(1), ev(2, { type: "text_start", blockId: "b1" }), text, text, ev(4, { type: "tool_start", callId: "c1", name: "run_command" }), ev(4, { type: "tool_start", callId: "c1", name: "run_command" })]);
    expect(items(state, "text")).toHaveLength(1);
    expect((items(state, "text")[0] as ItemOf<"text">).text).toBe("Hello");
    expect(items(state, "tool")).toHaveLength(1);
    expect(state.lastSeq).toBe(4);
    expect(state.eventCount).toBe(4);
  });

  it("drops events at or below the last applied seq across batches", () => {
    let state = run([startOf(1), ev(2, { type: "text_start", blockId: "b1" }), ev(3, { type: "text_delta", blockId: "b1", text: "a" })]);
    state = feed(state, [ev(2, { type: "text_start", blockId: "b1" }), ev(3, { type: "text_delta", blockId: "b1", text: "a" }), ev(4, { type: "text_delta", blockId: "b1", text: "b" })]);
    expect((items(state, "text")[0] as ItemOf<"text">).text).toBe("ab");
    expect(state.events.map(event => event.seq)).toEqual([1, 2, 3, 4]);
  });

  it("returns the same state object when a batch has nothing new", () => {
    const state = run([startOf(1)]);
    expect(feed(state, [startOf(1)])).toBe(state);
  });
});

describe("runs", () => {
  it("tracks run_start, attempt, trigger, status reason and the done outcome", () => {
    const state = run([
      startOf(1),
      ev(2, { type: "user_message", text: "Build it", clientMessageId: "m-1" }),
      ev(3, { type: "status", status: "queued" }),
      ev(4, { type: "status", status: "running" }),
      ev(5, { type: "done", status: "failed", answer: "", reason: "error", error: "Boom", outcome: { verification: "failed" } }),
      startOf(6, RUN_B, "retry", 2),
      ev(7, { type: "status", status: "running", reason: "retry" }),
    ]);
    expect(state.runs).toHaveLength(2);
    expect(state.runs[0]).toMatchObject({ runId: RUN_A, attempt: 1, trigger: "prompt", hasUser: true, status: "failed", reason: "error" });
    expect(state.runs[0].end).toMatchObject({ status: "failed", error: "Boom", reason: "error", outcome: { verification: "failed" } });
    expect(latestRun(state)).toMatchObject({ runId: RUN_B, attempt: 2, trigger: "retry", status: "running", reason: "retry" });
    expect(state.status).toBe("running");
    expect(state.statusReason).toBe("retry");
    const user = items(state, "user")[0] as ItemOf<"user">;
    expect(user.clientMessageId).toBe("m-1");
    expect(user.run).toBe(0);
  });

  it("clears the status reason when a status event has none", () => {
    const state = run([startOf(1), ev(2, { type: "status", status: "cancelling", reason: "user_cancel" }), ev(3, { type: "status", status: "running" })]);
    expect(state.statusReason).toBeNull();
  });

  it("splits older logs (no run_start) into runs at each follow-up message", () => {
    const state = run([
      ev(1, { type: "user_message", text: "First" }),
      ev(2, { type: "text_start", blockId: "t" }),
      ev(3, { type: "text_delta", blockId: "t", text: "One" }),
      ev(4, { type: "done", status: "completed", answer: "One" }),
      ev(5, { type: "user_message", text: "Second" }),
      ev(6, { type: "text_start", blockId: "t" }),
      ev(7, { type: "text_delta", blockId: "t", text: "Two" }),
    ]);
    expect(state.runs.map(info => [info.runId, info.trigger])).toEqual([[null, "prompt"], [null, "follow_up"]]);
    const texts = items(state, "text") as ItemOf<"text">[];
    expect(texts.map(text => [text.text, text.run])).toEqual([["One", 0], ["Two", 1]]);
  });

  it("treats the deploy run's message (and the old deploy prompt) as an action, not a user bubble", () => {
    const state = run([
      startOf(1),
      ev(2, { type: "user_message", text: "Hi" }),
      ev(3, { type: "done", status: "completed", answer: "Hello" }),
      startOf(4, RUN_B, "deploy", 2),
      ev(5, { type: "user_message", text: "Deploy a live preview" }),
    ]);
    const views = conversationRuns(state);
    expect(views[1].divider).toMatchObject({ trigger: "deploy" });
    expect(views[1].user).toBeNull();
    const legacy = run([
      ev(1, { type: "user_message", text: "Hi" }),
      ev(2, { type: "done", status: "completed", answer: "Hello" }),
      ev(3, { type: "user_message", text: "Deploy this project as a temporary live preview with deploy_preview (choose static or node…)" }),
    ]);
    const legacyViews = conversationRuns(legacy);
    expect(legacy.runs[1].trigger).toBe("deploy");
    expect(legacyViews[1].user).toBeNull();
    expect(legacyViews[1].divider).toMatchObject({ trigger: "deploy" });
  });

  it("shows a retry divider instead of a user bubble", () => {
    const views = conversationRuns(run([startOf(1), ev(2, { type: "user_message", text: "Hi" }), ev(3, { type: "done", status: "interrupted", answer: "", reason: "server_restart" }), startOf(4, RUN_B, "retry", 3)]));
    expect(views[1].divider).toMatchObject({ trigger: "retry", attempt: 3 });
    expect(views[1].user).toBeNull();
  });
});

describe("settling on done", () => {
  const busy = () => [
    startOf(1),
    ev(2, { type: "user_message", text: "Go" }),
    ev(3, { type: "phase", phase: "planning", state: "done" }),
    ev(4, { type: "phase", phase: "implementation", state: "active" }),
    ev(5, { type: "thinking_start", blockId: "th" }),
    ev(6, { type: "text_start", blockId: "tx" }),
    ev(7, { type: "tool_start", callId: "c1", name: "run_command" }),
    ev(8, { type: "browser_session", sessionId: "s1", status: "live", liveUrl: "https://www.browserbase.com/devtools?token=secret", replayUrl: "https://x", viewer: true }),
    ev(9, { type: "team_agent", role: "engineer", status: "working", model: "auto", activity: "editing" }),
    ev(10, { type: "deployment", deploymentId: DEP, callId: "c9", status: "building", detail: "Building" }),
  ];

  it("closes everything a cancelled run left open, with truthful labels", () => {
    const state = run([...busy(), ev(11, { type: "done", status: "cancelled", answer: "", reason: "user_cancel" })]);
    const tool = items(state, "tool")[0] as ItemOf<"tool">;
    expect(tool.result).toMatchObject({ ok: false, summary: "Stopped", settled: "stopped" });
    expect((items(state, "thinking")[0] as ItemOf<"thinking">).done).toBe(true);
    expect((items(state, "text")[0] as ItemOf<"text">).done).toBe(true);
    expect(state.phases.implementation.state).toBe("failed");
    expect(state.phases.implementation.note).toMatch(/cancelled/);
    expect(state.phases.planning.state).toBe("done");
    expect(state.browsers.s1).toMatchObject({ status: "ended", reason: "cancelled" });
    expect(state.team.engineer).toMatchObject({ status: "stopped" });
    expect(state.deployments[0].status).toBe("interrupted");
  });

  it("labels an interrupted run's tools Interrupted, a failed run's members failed, a completed run's phases done", () => {
    expect((items(run([...busy(), ev(11, { type: "done", status: "interrupted", answer: "" })]), "tool")[0] as ItemOf<"tool">).result).toMatchObject({ summary: "Interrupted", settled: "interrupted" });
    expect(run([...busy(), ev(11, { type: "done", status: "failed", answer: "", error: "x" })]).team.engineer?.status).toBe("failed");
    const completed = run([...busy(), ev(11, { type: "done", status: "completed", answer: "Done" })]);
    expect(completed.phases.implementation.state).toBe("done");
    expect(completed.team.engineer?.status).toBe("done");
    expect(completed.browsers.s1.reason).toBe("done");
  });

  it("closes the previous run's open items when a newer run starts without its done", () => {
    const state = run([...busy(), startOf(11, RUN_B, "retry", 2)]);
    expect((items(state, "tool")[0] as ItemOf<"tool">).result?.settled).toBe("interrupted");
    expect(state.phases.implementation.state).toBe("pending");
  });

  it("settles from the stored row when the log has no done event, and only then", () => {
    const open = run(busy());
    const settled = streamReducer(open, { type: "settle", status: "interrupted", reason: "server_restart", at: T0 + 500_000 });
    expect(latestRun(settled)?.end).toMatchObject({ status: "interrupted", synthetic: true, reason: "server_restart" });
    expect((items(settled, "tool")[0] as ItemOf<"tool">).result?.settled).toBe("interrupted");
    expect(settled.status).toBe("interrupted");
    expect(streamReducer(open, { type: "settle", status: "running", at: 1 })).toBe(open);
    const done = run([...busy(), ev(11, { type: "done", status: "completed", answer: "ok" })]);
    expect(streamReducer(done, { type: "settle", status: "failed", at: 1 })).toBe(done);
  });
});

describe("deployments", () => {
  it("joins an older log's tool-call progress and its row-id live event into one entry (by url)", () => {
    const state = run([
      startOf(1),
      ev(2, { type: "deployment", deploymentId: "toolu_1", status: "creating", detail: "Creating" }),
      ev(3, { type: "deployment", deploymentId: "toolu_1", status: "building", url: "https://curialy-preview-ab.onrender.com", detail: "Building" }),
      ev(4, { type: "deployment", deploymentId: DEP, status: "live", url: "https://curialy-preview-ab.onrender.com", detail: "Live", expiresAt: "2026-10-27T12:00:00.000Z" }),
    ]);
    expect(state.deployments).toHaveLength(1);
    expect(state.deployments[0]).toMatchObject({ id: DEP, status: "live", expiresAt: "2026-10-27T12:00:00.000Z" });
    expect(state.deployments[0].aliases).toContain("toolu_1");
  });

  it("joins an id-less progress entry to the row-id live event of the same run when no url matched", () => {
    const state = run([startOf(1), ev(2, { type: "deployment", deploymentId: "toolu_2", status: "creating", detail: "Creating" }), ev(3, { type: "deployment", deploymentId: DEP, status: "live", url: "https://a.onrender.com", detail: "Live" })]);
    expect(state.deployments).toHaveLength(1);
    expect(state.deployments[0].id).toBe(DEP);
  });

  it("keys new logs by the row id (with callId), maps deleted to removed and keeps sweeper events", () => {
    let list = mergeDeployment([], ev(2, { type: "deployment", deploymentId: DEP, callId: "c1", status: "creating", detail: "Creating" }) as Extract<AgentEvent, { type: "deployment" }>, 0);
    list = mergeDeployment(list, ev(3, { type: "deployment", deploymentId: DEP, callId: "c1", status: "live", url: "https://b.onrender.com", detail: "Live" }) as Extract<AgentEvent, { type: "deployment" }>, 0);
    list = mergeDeployment(list, ev(9, { type: "deployment", deploymentId: DEP, status: "expired", url: "https://b.onrender.com", detail: "The preview expired" }) as Extract<AgentEvent, { type: "deployment" }>, 1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "expired", run: 0, url: "https://b.onrender.com" });
    expect(mergeDeployment([], ev(2, { type: "deployment", deploymentId: DEP, status: "deleted", detail: "" }) as Extract<AgentEvent, { type: "deployment" }>, 0)[0].status).toBe("removed");
  });

  it("records a live deploy as a side effect of its run, once", () => {
    const state = run([startOf(1), ev(2, { type: "deployment", deploymentId: DEP, status: "live", url: "https://c.onrender.com", detail: "Live" }), ev(3, { type: "deployment", deploymentId: DEP, status: "live", url: "https://c.onrender.com", detail: "Live" }), ev(4, { type: "repo_push", fullName: "me/app", branch: "curialy/x", commitSha: "abcdef1234", commitUrl: "https://github.com/me/app/commit/abc", changed: 2, deleted: 0 })]);
    expect(runEffects(latestRun(state)).map(effect => effect.kind)).toEqual(["deploy", "push"]);
  });
});

describe("other events", () => {
  it("never keeps a live-view address from the log", () => {
    const state = run([startOf(1), ev(2, { type: "browser_session", sessionId: "s1", status: "live", liveUrl: "https://www.browserbase.com/x?token=t", replayUrl: "https://r", viewer: true })]);
    expect(JSON.stringify(state.browsers)).not.toMatch(/browserbase|token|liveUrl|replayUrl/);
    expect(state.browsers.s1).toMatchObject({ status: "live", viewer: true });
    expect(items(state, "browser")).toHaveLength(1);
  });

  it("keeps artifact sources, generated summaries and partial flags; media marked unavailable", () => {
    const state = run([
      startOf(1),
      ev(2, { type: "artifacts", files: [{ mediaId: null, source: "workspace", path: "out/report.pdf", filename: "report.pdf", mimeType: "application/pdf", sizeBytes: 10, kind: "pdf", primary: true }], auto: true, more: 0, skipped: [], generated: { count: 37, bytes: 1000, dirs: [{ dir: "frontend/dist", count: 37 }] }, partial: true }),
      ev(3, { type: "media", callId: "c", mediaId: null, filename: "shot.png", mimeType: "image/png", caption: "Home", unavailable: true }),
    ]);
    const attachments = items(state, "attachments")[0] as ItemOf<"attachments">;
    expect(attachments).toMatchObject({ partial: true, generated: { count: 37 } });
    expect(attachments.files[0]).toMatchObject({ mediaId: null, source: "workspace" });
    expect(items(state, "media")[0]).toMatchObject({ mediaId: null, unavailable: true });
  });

  it("trims very long tool output to its tail", () => {
    const chunk = "x".repeat(100 * 1024);
    const state = run([startOf(1), ev(2, { type: "tool_start", callId: "c", name: "run_command" }), ...[3, 4, 5, 6].map(seq => ev(seq, { type: "tool_output", callId: "c", stream: "stdout", chunk }))]);
    const tool = items(state, "tool")[0] as ItemOf<"tool">;
    expect(tool.outputBytes).toBeLessThanOrEqual(256 * 1024 + 64);
    expect(tool.output[0].text).toMatch(/earlier output trimmed/);
  });

  it("tags Dev Team items with their member", () => {
    const state = run([startOf(1), ev(2, { type: "text_start", blockId: "t" }, { agent: "architect" })]);
    expect(state.items.at(-1)?.agent).toBe("architect");
  });
});

describe("conversation view", () => {
  const completed = (answer: string) => run([
    startOf(1),
    ev(2, { type: "user_message", text: "Fix it" }),
    ev(3, { type: "text_start", blockId: "a" }),
    ev(4, { type: "text_delta", blockId: "a", text: "Looking at the code" }),
    ev(5, { type: "text_end", blockId: "a" }),
    ev(6, { type: "text_start", blockId: "b" }),
    ev(7, { type: "text_delta", blockId: "b", text: "Fixed the bug." }),
    ev(8, { type: "text_end", blockId: "b" }),
    ev(9, { type: "done", status: "completed", answer }),
  ]);

  it("takes the answer from done and keeps the other messages as progress notes", () => {
    const [view] = conversationRuns(completed("Fixed the bug.\n\n> **Verification failed** after 3 attempts"));
    expect(view.answer).toMatch(/^Fixed the bug/);
    expect(view.answerSource?.text).toBe("Fixed the bug.");
    expect(view.notes.map(note => note.text)).toEqual(["Looking at the code"]);
  });

  it("falls back to the last message for an older log without an answer", () => {
    const [view] = conversationRuns(completed(""));
    expect(view.answer).toBe("Fixed the bug.");
    expect(view.notes).toHaveLength(1);
  });

  it("never treats a failed run's last message as an answer", () => {
    const [view] = conversationRuns(run([startOf(1), ev(2, { type: "text_start", blockId: "a" }), ev(3, { type: "text_delta", blockId: "a", text: "Partial" }), ev(4, { type: "error", message: "It broke" }), ev(5, { type: "done", status: "failed", answer: "", error: "It broke" })]));
    expect(view.answer).toBe("");
    expect(view.answerSource).toBeNull();
    expect(view.notes).toHaveLength(1);
    expect(runError(view.run)).toBe("It broke");
  });

  it("resolves the answer from the stored row when the log lacks it", () => {
    const state = run([startOf(1), ev(2, { type: "text_start", blockId: "a" }), ev(3, { type: "text_delta", blockId: "a", text: "Draft" })]);
    const [view] = conversationRuns(state);
    expect(resolveAnswer(view, "Final answer").answer).toBe("Final answer");
    expect(resolveAnswer(view, "Final answer").notes).toHaveLength(1);
    expect(resolveAnswer(view, null)).toMatchObject({ answer: "Draft", notes: [] });
  });

  it("keeps team reports out of the cards (the answer covers them)", () => {
    const [view] = conversationRuns(run([startOf(1), ev(2, { type: "handoff", from: "reviewer", to: "user", kind: "report", title: "Report", content: "x" }), ev(3, { type: "handoff", from: "architect", to: "engineer", kind: "plan", title: "Plan", content: "y" })]));
    expect(view.cards.map(card => card.kind === "handoff" && card.handoff)).toEqual(["plan"]);
  });
});

describe("connection state", () => {
  it("records the replay mark from the first sync only, and live only for a live channel", () => {
    let state = streamReducer(initialStreamState(), { type: "open" });
    state = streamReducer(state, { type: "sync", sync: { maxSeq: 40, status: "running", statusReason: null, runId: RUN_A, live: true, at: 1 } });
    expect(state).toMatchObject({ connected: true, live: true, replayMark: 40 });
    state = streamReducer(state, { type: "ended", at: 2 });
    expect(state).toMatchObject({ connected: false, live: false, ended: true, endedAt: 2 });
    state = streamReducer(state, { type: "sync", sync: { maxSeq: 90, status: "completed", statusReason: null, runId: RUN_A, live: false, at: 3 } });
    expect(state).toMatchObject({ replayMark: 40, live: false, ended: false });
    expect(streamReducer(state, { type: "missing" }).missing).toBe(true);
  });
});

describe("helpers", () => {
  it("picks the newest status snapshot", () => {
    expect(freshestStatus(null, { status: "running", at: 1 }, { status: "completed", at: 5 }, undefined, { status: "queued", at: 3 })).toMatchObject({ status: "completed" });
    expect(freshestStatus(null, undefined)).toBeNull();
  });

  it("opens the Inspector on what the reader most likely came for", () => {
    expect(initialInspectorTab({ status: "running", liveDeployment: true, previewAvailable: true })).toBe("activity");
    expect(initialInspectorTab({ status: "failed", liveDeployment: true, previewAvailable: true })).toBe("activity");
    expect(initialInspectorTab({ status: "interrupted", liveDeployment: false, previewAvailable: true })).toBe("activity");
    expect(initialInspectorTab({ status: "completed", liveDeployment: true, previewAvailable: false })).toBe("preview");
    expect(initialInspectorTab({ status: "completed", liveDeployment: false, previewAvailable: true })).toBe("preview");
    expect(initialInspectorTab({ status: "completed", liveDeployment: false, previewAvailable: false })).toBe("activity");
    expect(initialInspectorTab({ status: null, liveDeployment: false, previewAvailable: true })).toBe("activity");
  });

  it("backs off from 1 s to 30 s with bounded jitter", () => {
    expect(reconnectDelay(1, () => 0)).toBe(1000);
    expect(reconnectDelay(1, () => 1)).toBe(1250);
    expect(reconnectDelay(3, () => 0.5)).toBe(4000);
    expect(reconnectDelay(5, () => 0)).toBe(12000);
    for (let attempt = 1; attempt < 40; attempt++) {
      for (const r of [0, 0.3, 0.999]) {
        const delay = reconnectDelay(attempt, () => r);
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(30_000);
      }
    }
    expect(reconnectDelay(10, () => 0.999)).toBe(30_000);
  });

  it("hides vendor links and preview tokens, and leaves other links alone", () => {
    expect(isVendorUrl("https://curialy-preview-ab12.onrender.com/")).toBe(true);
    expect(isVendorUrl("https://example.com/render")).toBe(false);
    expect(scrubText("[deploy:live] Live https://curialy-preview-ab12.onrender.com and https://example.com/a")).toBe("[deploy:live] Live [link hidden] and https://example.com/a");
    expect(scrubText("wss://connect.browserbase.com/x?signingKey=abc")).toBe("[link hidden]");
    expect(maskPreviewToken("/api/workspace/preview/123e4567/tok.en-123/?dir=dist")).toBe("/api/workspace/preview/123e4567/…/?dir=dist");
  });
});
