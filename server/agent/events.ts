import type { AgentEventBody } from "@shared/agent";
import { liveChannel } from "./bus";
import { appendLoggedEvents } from "./lifecycle";

/**
 * Record an event on a task's log from outside its run (deploy sweeper, reconcilers): through the
 * live channel while a run streams, otherwise straight into the persisted log after its last event.
 */
export async function appendTaskEvent(taskId: string, body: AgentEventBody) {
  const live = liveChannel(taskId);
  if (live && !live.sealed) {
    live.emit(body);
    return;
  }
  await appendLoggedEvents(taskId, [body]);
}
