import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Switch from "@radix-ui/react-switch";
import { CalendarClock, Pencil, Play, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { PICKER_MODELS } from "@shared/agent";
import { describeSchedule, MAX_INTERVAL_HOURS, MAX_SCHEDULE_FAILURES, MIN_INTERVAL_HOURS, nextRunAt, parseCron, validTimeZone, type ScheduledTask, type ScheduleInput, type ScheduleRun } from "@shared/schedules";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StateNotice } from "@/components/common/StateNotice";
import { errorMessage, relativeTime, schedulesApi } from "@/lib/api";
import { untilText } from "@/lib/account";

// Scheduled tasks: prompts the account runs by itself every few hours or at set times. Each run is
// an ordinary task (it uses credits, appears under Live Tasks, and is skipped when another task of
// the account is still running). The form builds the timetable from a few common choices, or takes
// a cron expression, and shows when it would run next before anything is saved.

type Kind = "interval" | "daily" | "weekdays" | "weekly" | "cron";
const KINDS: { id: Kind; label: string }[] = [
  { id: "interval", label: "Every few hours" },
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "cron", label: "Cron" },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Form = { title: string; prompt: string; kind: Kind; hours: string; time: string; weekday: string; cron: string; timeZone: string; mode: "agent" | "chat"; model: string; repo: string };

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** Every time zone the browser knows, the viewer's first (a short list where the browser can't list them). */
function timeZones(current: string) {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return [...new Set([current, browserZone(), "UTC", ...all])].filter(validTimeZone);
}

const blankForm = (prompt = ""): Form => ({ title: "", prompt, kind: "daily", hours: "24", time: "09:00", weekday: "1", cron: "0 9 * * 1-5", timeZone: browserZone(), mode: "agent", model: "auto", repo: "" });

/** A saved schedule in the form's terms (its cron read back into a common choice where it is one). */
function formOf(schedule: ScheduledTask): Form {
  const base = { ...blankForm(schedule.prompt), title: schedule.title, timeZone: schedule.timeZone, mode: schedule.mode, model: schedule.model, repo: schedule.repo ?? "" };
  if (schedule.intervalHours) return { ...base, kind: "interval", hours: String(schedule.intervalHours) };
  const cron = schedule.cron ?? "";
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(cron.trim());
  if (!match) return { ...base, kind: "cron", cron };
  const time = `${match[2].padStart(2, "0")}:${match[1].padStart(2, "0")}`;
  return match[3] === "*" ? { ...base, kind: "daily", time, cron } : match[3] === "1-5" ? { ...base, kind: "weekdays", time, cron } : { ...base, kind: "weekly", time, weekday: match[3], cron };
}

/** The timetable the form describes, or what's wrong with it. */
function timetableOf(form: Form): { cron: string | null; intervalHours: number | null } | { error: string } {
  if (form.kind === "interval") {
    const hours = Number(form.hours);
    if (!Number.isInteger(hours) || hours < MIN_INTERVAL_HOURS || hours > MAX_INTERVAL_HOURS) return { error: `Hours are a whole number from ${MIN_INTERVAL_HOURS} to ${MAX_INTERVAL_HOURS}.` };
    return { cron: null, intervalHours: hours };
  }
  if (form.kind === "cron") {
    const parsed = parseCron(form.cron);
    return "error" in parsed ? { error: parsed.error } : { cron: form.cron.trim().replace(/\s+/g, " "), intervalHours: null };
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(form.time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { error: "Choose a time of day." };
  const [hour, minute] = [Number(match[1]), Number(match[2])];
  const days = form.kind === "daily" ? "*" : form.kind === "weekdays" ? "1-5" : form.weekday;
  return { cron: `${minute} ${hour} * * ${days}`, intervalHours: null };
}

const whenText = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Create (no schedule) or edit one. */
function ScheduleForm({ schedule, seedPrompt, onSaved, onCancel }: { schedule?: ScheduledTask; seedPrompt?: string; onSaved: () => void; onCancel?: () => void }) {
  const [form, setForm] = useState<Form>(() => (schedule ? formOf(schedule) : blankForm(seedPrompt)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const id = useId();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  const timetable = timetableOf(form);
  const zones = useMemo(() => timeZones(form.timeZone), [form.timeZone]);
  const models = useMemo(() => PICKER_MODELS.filter(model => form.mode === "chat" || model.tools), [form.mode]);
  const preview = "error" in timetable ? null : nextRunAt({ ...timetable, timeZone: form.timeZone }, Date.now());
  const repoError = form.mode === "agent" && form.repo.trim() && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(form.repo.trim()) ? "Write the repository as owner/name." : null;
  const missing = !form.title.trim() ? "Give the schedule a name." : form.prompt.trim().length < 2 ? "Describe what the task should do." : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (busy || missing || repoError || "error" in timetable) return;
    setBusy(true);
    setError(null);
    const input: ScheduleInput = {
      title: form.title.trim(), prompt: form.prompt.trim(), ...timetable, timeZone: form.timeZone, mode: form.mode, model: form.model,
      repo: form.mode === "agent" && form.repo.trim() ? form.repo.trim() : null,
    };
    try {
      if (schedule) await schedulesApi.update(schedule.id, input);
      else await schedulesApi.create(input);
      toast.success(schedule ? `${input.title} saved.` : `${input.title} scheduled.`);
      if (!schedule) setForm(blankForm());
      setTried(false);
      onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError, "Couldn't save the schedule."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sched-form" onSubmit={event => void submit(event)} noValidate>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-title`}>Name</label>
        <input id={`${id}-title`} className="input" value={form.title} maxLength={120} onChange={event => set("title", event.target.value)} placeholder="Morning issue summary" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-prompt`}>What the task should do</label>
        <textarea id={`${id}-prompt`} className="input textarea" value={form.prompt} maxLength={20_000} rows={4} onChange={event => set("prompt", event.target.value)} placeholder="Check octo/site for issues opened since yesterday and summarise them by priority." />
        <span className="field-hint">Each run starts a new task with this prompt, as if you had sent it.</span>
      </div>
      <fieldset className="sched-when">
        <legend className="field-label" id={`${id}-kind`}>When it runs</legend>
        <RadioGroup.Root className="segmented sched-kinds" aria-labelledby={`${id}-kind`} value={form.kind} onValueChange={value => set("kind", value as Kind)} orientation="horizontal" loop>
          {KINDS.map(kind => <RadioGroup.Item key={kind.id} value={kind.id}>{kind.label}</RadioGroup.Item>)}
        </RadioGroup.Root>
        <div className="sched-when-row">
          {form.kind === "interval" && (
            <div className="field">
              <label className="field-label" htmlFor={`${id}-hours`}>Every (hours)</label>
              <input id={`${id}-hours`} className="input sched-narrow" type="number" inputMode="numeric" min={MIN_INTERVAL_HOURS} max={MAX_INTERVAL_HOURS} step={1} value={form.hours} onChange={event => set("hours", event.target.value)} />
            </div>
          )}
          {(form.kind === "daily" || form.kind === "weekdays" || form.kind === "weekly") && (
            <>
              {form.kind === "weekly" && (
                <div className="field">
                  <label className="field-label" htmlFor={`${id}-day`}>Day</label>
                  <select id={`${id}-day`} className="select" value={form.weekday} onChange={event => set("weekday", event.target.value)}>
                    {WEEKDAYS.map((day, index) => <option key={day} value={String(index)}>{day}</option>)}
                  </select>
                </div>
              )}
              <div className="field">
                <label className="field-label" htmlFor={`${id}-time`}>At</label>
                <input id={`${id}-time`} className="input sched-narrow" type="time" step={60} value={form.time} onChange={event => set("time", event.target.value)} />
              </div>
            </>
          )}
          {form.kind === "cron" && (
            <div className="field sched-grow">
              <label className="field-label" htmlFor={`${id}-cron`}>Cron expression</label>
              <input id={`${id}-cron`} className="input mono" value={form.cron} maxLength={100} spellCheck={false} onChange={event => set("cron", event.target.value)} placeholder="0 9 * * 1-5" />
              <span className="field-hint">Minute, hour, day of month, month, day of week. The minute is one number: at most one run an hour.</span>
            </div>
          )}
          {form.kind !== "interval" && (
            <div className="field sched-grow">
              <label className="field-label" htmlFor={`${id}-zone`}>Time zone</label>
              <select id={`${id}-zone`} className="select" value={form.timeZone} onChange={event => set("timeZone", event.target.value)}>
                {zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </div>
          )}
        </div>
        <p className="field-hint sched-preview" role="status">
          {"error" in timetable ? (tried ? <span className="field-error"><TriangleAlert size={14} aria-hidden="true" />{timetable.error}</span> : timetable.error)
            : preview === null ? "That timetable doesn't come round in the next year."
              : `${describeSchedule({ ...timetable, timeZone: form.timeZone })}. ${schedule ? "Next run" : "First run"}: ${whenText(new Date(preview).toISOString())} your time.`}
        </p>
      </fieldset>
      <div className="sched-when-row">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-mode`}>Mode</label>
          <select id={`${id}-mode`} className="select" value={form.mode} onChange={event => set("mode", event.target.value as Form["mode"])}>
            <option value="agent">Agent (works in a workspace)</option>
            <option value="chat">Chat (answers only)</option>
          </select>
        </div>
        <div className="field sched-grow">
          <label className="field-label" htmlFor={`${id}-model`}>Model</label>
          <select id={`${id}-model`} className="select" value={models.some(model => model.id === form.model) ? form.model : "auto"} onChange={event => set("model", event.target.value)}>
            <option value="auto">Auto (picks for each run)</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
        </div>
        {form.mode === "agent" && (
          <div className="field sched-grow">
            <label className="field-label" htmlFor={`${id}-repo`}>Repository <span className="field-hint">(optional)</span></label>
            <input id={`${id}-repo`} className="input mono" value={form.repo} maxLength={200} spellCheck={false} onChange={event => set("repo", event.target.value)} placeholder="owner/name" aria-invalid={Boolean(tried && repoError) || undefined} />
            <span className="field-hint">{tried && repoError ? repoError : "Cloned into the task's workspace first (GitHub must be connected)."}</span>
          </div>
        )}
      </div>
      {tried && missing && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{missing}</p>}
      {error && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{error}</p>}
      <div className="request-actions">
        <Button type="submit" variant="primary" icon={schedule ? undefined : Plus} busy={busy}>{schedule ? "Save changes" : "Add schedule"}</Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

const OUTCOME: Record<ScheduleRun["outcome"], { label: string; tone: "success" | "warning" | "danger" }> = {
  started: { label: "Started", tone: "success" },
  skipped: { label: "Skipped", tone: "warning" },
  failed: { label: "Didn't start", tone: "danger" },
};

function ScheduleRow({ schedule, onChanged }: { schedule: ScheduledTask; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [toggling, setToggling] = useState(false);
  const runNow = async () => {
    setRunning(true);
    try {
      const result = await schedulesApi.run(schedule.id);
      toast.success(`${schedule.title} started.`, { action: { label: "Open", onClick: () => { window.location.assign(`/tasks/${result.taskId}`); } } });
    } catch (runError) {
      toast.error(errorMessage(runError, "The task didn't start."));
    } finally {
      setRunning(false);
      onChanged();
    }
  };
  const toggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await schedulesApi.update(schedule.id, { enabled });
      toast.success(enabled ? `${schedule.title} is on again.` : `${schedule.title} is paused.`);
      onChanged();
    } catch (toggleError) {
      toast.error(errorMessage(toggleError, "Couldn't change the schedule."));
    } finally {
      setToggling(false);
    }
  };
  const remove = async () => {
    await schedulesApi.remove(schedule.id);
    toast.success(`${schedule.title} deleted.`);
    onChanged();
  };
  const switchId = useId();
  return (
    <li className="secret-row sched-row" data-off={!schedule.enabled || undefined}>
      <div className="secret-row-main">
        <CalendarClock size={15} aria-hidden="true" />
        <div className="secret-row-text">
          <span className="secret-name">{schedule.title}</span>
          <span className="secret-note">{describeSchedule(schedule)}</span>
          <span className="secret-meta">
            {schedule.enabled ? `Next run ${whenText(schedule.nextRunAt)} (${untilText(schedule.nextRunAt)})` : "Paused"}
            {schedule.lastRunAt ? ` · last ran ${relativeTime(schedule.lastRunAt)}` : ""}
          </span>
          {schedule.disabledReason && <span className="field-error sched-off"><TriangleAlert size={13} aria-hidden="true" />{schedule.disabledReason}</span>}
          <span className="sched-prompt">{schedule.prompt}</span>
        </div>
        <div className="secret-row-actions sched-actions">
          <span className="sched-switch">
            <Switch.Root id={switchId} className="switch" checked={schedule.enabled} disabled={toggling} onCheckedChange={checked => void toggle(checked)}>
              <Switch.Thumb className="switch-thumb" />
            </Switch.Root>
            <label htmlFor={switchId} className="field-hint">{schedule.enabled ? "On" : "Off"}</label>
          </span>
          <Button size="sm" icon={Play} busy={running} onClick={() => void runNow()}>Run now</Button>
          <Button size="sm" icon={Pencil} onClick={() => setEditing(current => !current)} aria-expanded={editing}>Edit</Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmOpen(true)} aria-label={`Delete ${schedule.title}`}>Delete</Button>
        </div>
      </div>
      {schedule.runs.length > 0 && (
        <ul className="sched-runs" aria-label={`Latest runs of ${schedule.title}`}>
          {schedule.runs.slice(0, 3).map(run => (
            <li key={run.id}>
              <span className="chip" data-tone={OUTCOME[run.outcome].tone}>{OUTCOME[run.outcome].label}</span>
              <span className="secret-meta">{relativeTime(run.startedAt)}</span>
              {run.taskId ? <Link href={`/tasks/${run.taskId}`} className="link">Open the task</Link> : run.detail ? <span className="secret-meta sched-detail">{run.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {editing && <ScheduleForm schedule={schedule} onSaved={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />}
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={`Delete ${schedule.title}?`} confirmLabel="Delete" busyLabel="Deleting…" tone="danger" onConfirm={remove}>
        It stops running. Tasks it already started stay in Live Tasks.
      </ConfirmDialog>
    </li>
  );
}

export default function Schedules() {
  const [data, setData] = useState<Awaited<ReturnType<typeof schedulesApi.list>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "/schedule <prompt>" from a composer opens this page with the prompt filled in.
  const [seed] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("prompt")?.slice(0, 20_000) ?? "";
    } catch {
      return "";
    }
  });
  const load = useCallback(() => {
    setError(null);
    schedulesApi.list().then(setData, loadError => setError(errorMessage(loadError, "Couldn't load your schedules.")));
  }, []);
  useEffect(() => load(), [load]);

  return (
    <AppShell title="Schedules">
      <div className="page">
        <div className="page-narrow">
          <header className="page-head">
            <div>
              <span className="eyebrow">Automation</span>
              <h2 className="page-title">Scheduled tasks</h2>
              <p className="page-sub">Tasks that start by themselves every few hours or at set times. Each run is an ordinary task: it uses credits like any other, appears under Live Tasks, and is skipped if another task of yours is still running then. A schedule that can't start {MAX_SCHEDULE_FAILURES} times in a row turns itself off and says why.</p>
            </div>
          </header>

          {data === null ? (
            error ? (
              <div className="card"><StateNotice variant="error" title="Couldn't load your schedules" actions={<Button variant="primary" icon={RotateCcw} onClick={load}>Try again</Button>}>{error}</StateNotice></div>
            ) : (
              <div className="card secret-card"><p className="sr-only" role="status">Loading…</p><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>
            )
          ) : (
            <>
              <section className="card secret-card" aria-labelledby="sched-add-title">
                <h3 id="sched-add-title" className="secret-card-title"><Plus size={16} aria-hidden="true" />New schedule</h3>
                {data.schedules.length >= data.limits.max ? <p className="field-hint">You have the most schedules an account can keep ({data.limits.max}). Delete one to add another.</p> : <ScheduleForm seedPrompt={seed} onSaved={load} />}
              </section>
              <section className="card secret-card" aria-labelledby="sched-list-title">
                <h3 id="sched-list-title" className="secret-card-title">Your schedules <span className="secret-count">{data.schedules.length} of {data.limits.max}</span></h3>
                {data.schedules.length === 0 ? (
                  <StateNotice variant="empty" size="sm" title="Nothing scheduled yet">Add one above, or type /schedule followed by a prompt in the task composer.</StateNotice>
                ) : (
                  <ul className="secret-list">{data.schedules.map(schedule => <ScheduleRow key={schedule.id} schedule={schedule} onChanged={load} />)}</ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
