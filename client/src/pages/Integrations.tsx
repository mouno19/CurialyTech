import { useEffect, useState } from "react";
import { Loader2, PlugZap, RefreshCcw } from "lucide-react";
import { PICKER_MODELS as MODELS } from "@shared/agent";
import { AppShell } from "@/components/shell/AppShell";
import { agentApi, type ProviderProbe } from "@/lib/api";

const PROVIDER_FOR: Record<string, string[]> = { core: ["core", "core-chat", "core-inference", "core-sql"], relay: ["relay"], fast: ["fast"], research: ["research"], gemini: [] };
const NON_GEMINI = (group: string) => group !== "Gemini";

export default function Integrations() {
  const [providers, setProviders] = useState<ProviderProbe[] | null>(null);
  const [deepRunning, setDeepRunning] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [deep, setDeep] = useState(false);

  const load = async (deepCheck: boolean) => {
    if (deepCheck) setDeepRunning(true);
    try {
      const data = await agentApi.health(deepCheck);
      setProviders(data.providers);
      setCheckedAt(new Date());
      setDeep(deepCheck);
    } finally {
      setDeepRunning(false);
    }
  };
  useEffect(() => { void load(false); }, []);

  return (
    <AppShell title="System Integrations" actions={<button className="btn sm" disabled={deepRunning} onClick={() => void load(true)}>{deepRunning ? <Loader2 size={13} className="spin" /> : <RefreshCcw size={13} />} Run live model check</button>}>
      <div className="page">
        <div className="page-narrow">
          <p className="page-sub">Curialy engines and services used by the agent. A quick check pings each endpoint; the live check sends a tiny real completion to verify end-to-end.{checkedAt && ` Last ${deep ? "live" : "quick"} check ${checkedAt.toLocaleTimeString()}.`}</p>
          <div className="grid grid-2">
            {(providers ?? []).map(probe => {
              const models = probe.id === "gemini" ? MODELS.filter(model => model.group === "Gemini") : MODELS.filter(model => PROVIDER_FOR[probe.id]?.includes(model.provider) && NON_GEMINI(model.group));
              return (
                <div key={probe.id} className="card">
                  <div className="card-head">
                    <div className="row"><span className={`dot ${!probe.configured ? "" : probe.ok ? "ok" : "bad"}`} /><h3>{probe.label}</h3></div>
                    <span className={`chip ${!probe.configured ? "" : probe.ok ? "mint" : "red"}`}>{!probe.configured ? "not configured" : probe.ok ? `${probe.latencyMs} ms` : "error"}</span>
                  </div>
                  <div className="card-pad">
                    <div className="muted" style={{ fontSize: 12.5, marginBottom: 10, wordBreak: "break-word" }}>{probe.detail}</div>
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{models.map(model => <span key={model.id} className="chip">{model.label}</span>)}</div>
                  </div>
                </div>
              );
            })}
            {providers === null && <div className="card card-pad muted"><PlugZap size={14} /> Checking…</div>}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
