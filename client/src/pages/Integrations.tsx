import { useId, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AudioLines, Check, CircleDashed, CircleHelp, CircleX, Cpu, Database, Gauge, HardDrive, Mic, Monitor, PlugZap, RefreshCw, Rocket, RotateCcw, Server, Sparkles, Telescope, TriangleAlert, Wrench } from "lucide-react";
import { PICKER_MODELS, type ModelSpec } from "@shared/agent";
import { AppShell, type TopbarAction } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import { relativeTime, type ProviderProbe } from "@/lib/api";
import { healthStatus, needsOperator, summarizeHealth, useHealth } from "@/lib/appStatus";

const GROUPS: { id: string; title: string; description: string; ids: string[] }[] = [
  { id: "engines", title: "Model engines", description: "The routes the models run on.", ids: ["core", "relay", "gemini", "fast"] },
  { id: "services", title: "Agent services", description: "Tools the agent can call during a task.", ids: ["research", "browser", "deploy", "voice", "voice-studio"] },
  { id: "storage", title: "Data and storage", description: "Where tasks, logs and files are kept.", ids: ["data", "vault"] },
];
const ICONS: Record<string, LucideIcon> = { core: Cpu, relay: Server, gemini: Sparkles, fast: Gauge, research: Telescope, browser: Monitor, deploy: Rocket, data: Database, vault: HardDrive, voice: Mic, "voice-studio": AudioLines };

// Which picker models each engine serves (Gemini models are listed on their own engine).
const PROVIDERS_FOR: Record<string, ModelSpec["provider"][]> = { core: ["core", "core-chat", "core-inference", "core-sql"], relay: ["relay"], fast: ["fast"] };
function modelsFor(id: string) {
  if (id === "gemini") return PICKER_MODELS.filter(model => model.group === "Gemini");
  const providers = PROVIDERS_FOR[id];
  return providers ? PICKER_MODELS.filter(model => providers.includes(model.provider) && model.group !== "Gemini") : [];
}

type Status = { label: string; tone: "success" | "warning" | "danger" | "neutral"; icon: LucideIcon };
/** A quick check only routes some engines; it says so instead of claiming they work. */
const unverified = (probe: ProviderProbe) => /run the live check/i.test(probe.detail);

function probeStatus(probe: ProviderProbe): Status {
  if (!probe.configured) return { label: "Not configured", tone: "neutral", icon: CircleDashed };
  if (!probe.ok) return needsOperator(probe) ? { label: "Needs setup", tone: "warning", icon: Wrench } : { label: "Unavailable", tone: "danger", icon: CircleX };
  if (unverified(probe)) return { label: "Not verified", tone: "neutral", icon: CircleHelp };
  return { label: "Operational", tone: "success", icon: Check };
}

const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function Integrations() {
  const { providers, error, checkedAt, checking, summary, refresh } = useHealth();
  const [deep, setDeep] = useState<{ running: boolean; at: number | null }>({ running: false, at: null });
  const [announcement, setAnnouncement] = useState("");

  const recheck = async () => {
    if (deep.running) return;
    setDeep(current => ({ ...current, running: true }));
    setAnnouncement("Running a live check on every engine. This can take up to 45 seconds.");
    await refresh(true);
    const snapshot = healthStatus.get();
    setDeep({ running: false, at: snapshot.error ? null : snapshot.checkedAt });
    setAnnouncement(snapshot.error ? `The live check failed: ${snapshot.error}` : `Live check finished: ${summarizeHealth(snapshot).label}.`);
  };

  const lastWasDeep = Boolean(deep.at && checkedAt && deep.at >= checkedAt);
  const known = new Set(GROUPS.flatMap(group => group.ids));
  const groups = [...GROUPS, { id: "other", title: "Other services", description: "", ids: (providers ?? []).map(probe => probe.id).filter(id => !known.has(id)) }];
  const actions: TopbarAction[] = [
    { id: "recheck", label: deep.running ? "Checking…" : "Re-check", icon: RefreshCw, priority: "primary", busy: deep.running, title: "Send a small real request to every engine (up to 45 s)", onSelect: () => void recheck() },
  ];

  return (
    <AppShell title="System Integrations" topbarActions={actions}>
      <div className="page">
        <div className="page-narrow">
          <header className="page-head">
            <div>
              <span className="eyebrow">Systems</span>
              <h2 className="page-title">System Integrations</h2>
              <p className="page-sub">
                The engines and services the agent depends on. Curialy checks them quietly in the background; Re-check sends a small real request to every engine to confirm it works end to end.
              </p>
            </div>
          </header>
          <p className="sr-only" role="status">{announcement}</p>

          {providers && (
            <div className="sys-summary" data-tone={summary.tone}>
              <span className="dot" data-tone={summary.tone} aria-hidden="true" />
              <strong>{summary.label}</strong>
              <span className="sys-summary-meta">
                {checkedAt ? `Checked ${relativeTime(new Date(checkedAt).toISOString())} at ${clock(checkedAt)} · ${lastWasDeep ? "live check" : "quick check"}` : ""}
                {checking && !deep.running ? " · checking…" : ""}
              </span>
            </div>
          )}
          {deep.running && (
            <div className="notice pg-notice" data-tone="info">
              <RefreshCw size={16} className="spin" aria-hidden="true" />
              <div className="notice-body">Running a live check on every engine. This can take up to 45 seconds.</div>
            </div>
          )}
          {error && providers && (
            <div className="notice pg-notice" data-tone="danger" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <div className="notice-body"><strong className="notice-title">The last check didn't complete</strong><p>{error} The results below are from the check before it.</p></div>
              <div className="notice-actions"><Button size="sm" icon={RotateCcw} onClick={() => void refresh()}>Try again</Button></div>
            </div>
          )}

          {!providers ? (
            error ? (
              <div className="card">
                <StateNotice variant="error" icon={PlugZap} title="Couldn't check the systems" actions={<Button variant="primary" icon={RotateCcw} busy={checking} onClick={() => void refresh()}>Try again</Button>}>{error}</StateNotice>
              </div>
            ) : (
              <SystemsSkeleton />
            )
          ) : (
            groups.map(group => {
              const probes = group.ids.map(id => providers.find(probe => probe.id === id)).filter((probe): probe is ProviderProbe => Boolean(probe));
              if (!probes.length) return null;
              return (
                <section key={group.id} className="page-section sys-group" aria-labelledby={`sys-group-${group.id}`}>
                  <div className="sys-group-head">
                    <h3 id={`sys-group-${group.id}`} className="section-title">{group.title}</h3>
                    {group.description && <p className="faint">{group.description}</p>}
                  </div>
                  <div className="cols-2">
                    {probes.map(probe => <ProbeCard key={probe.id} probe={probe} />)}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}

const SHOWN_MODELS = 8;

function ProbeCard({ probe }: { probe: ProviderProbe }) {
  const titleId = useId();
  const listId = useId();
  const [allModels, setAllModels] = useState(false);
  const status = probeStatus(probe);
  const Icon = ICONS[probe.id] ?? PlugZap;
  const models = modelsFor(probe.id);
  const shown = allModels ? models : models.slice(0, SHOWN_MODELS);
  const latency = probe.configured && probe.ok && !unverified(probe) && probe.latencyMs > 0 && probe.id !== "vault" ? `${probe.latencyMs.toLocaleString()} ms` : null;
  const storageNote = probe.id === "vault" && !(probe.configured && probe.ok)
    ? !probe.configured || needsOperator(probe)
      ? "Uploads, screenshots and attachments are paused. An operator needs to finish the storage setup."
      : "Uploads and file previews are paused until it's back. Curialy keeps checking on its own."
    : null;
  return (
    <article className="card sys-card" aria-labelledby={titleId}>
      <div className="sys-head">
        <span className="sys-icon" aria-hidden="true"><Icon size={16} /></span>
        <h4 id={titleId} className="sys-title">{probe.label}</h4>
        <span className="status-badge" data-tone={status.tone} data-size="sm">
          <status.icon size={12} aria-hidden="true" />
          {status.label}
        </span>
      </div>
      <p className="sys-detail">{probe.configured ? probe.detail : "Not configured on this server."}</p>
      {storageNote && <p className="sys-note">{storageNote}</p>}
      {(latency || models.length > 0) && (
        <dl className="sys-facts">
          {latency && (
            <div>
              <dt>Response</dt>
              <dd>{latency}</dd>
            </div>
          )}
          {models.length > 0 && (
            <div>
              <dt>Models</dt>
              <dd>{models.length}</dd>
            </div>
          )}
        </dl>
      )}
      {models.length > 0 && (
        <div className="sys-models">
          <ul id={listId} className="sys-model-list" aria-label={`Models on ${probe.label}`}>
            {shown.map(model => <li key={model.id} className="chip">{model.label}</li>)}
          </ul>
          {models.length > SHOWN_MODELS && (
            <Button variant="link" className="sys-more" aria-expanded={allModels} aria-controls={listId} onClick={() => setAllModels(value => !value)}>
              {allModels ? "Show fewer" : `Show all ${models.length}`}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function SystemsSkeleton() {
  return (
    <div className="page-section">
      <p className="sr-only" role="status">Checking systems…</p>
      <div className="cols-2" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="card sys-card">
            <span className="skeleton skeleton-text sys-skeleton-title" />
            <span className="skeleton skeleton-text" />
            <span className="skeleton skeleton-text sys-skeleton-short" />
          </div>
        ))}
      </div>
    </div>
  );
}
