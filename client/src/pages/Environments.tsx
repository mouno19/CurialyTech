import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Switch from "@radix-ui/react-switch";
import {
  Check,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Star,
  Terminal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { COMPUTE_KIND_LABELS, formatRam, summarizeSpecs, type ComputeEnvironment, type ComputeKind } from "@shared/compute";
import { AppShell, type TopbarAction } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Spinner } from "@/components/common/Spinner";
import { StateNotice } from "@/components/common/StateNotice";
import { computeApi, errorMessage, relativeTime } from "@/lib/api";
import { useAccount } from "@/lib/account";

type ActivePairing = {
  environment: ComputeEnvironment;
  token: string;
  connectedOnce: boolean;
};

function buildOneLiner(kind: ComputeKind, token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://curialy.tech";
  if (kind === "colab") {
    return `!curl -fsSL ${origin}/api/compute/connect.sh | bash -s -- --colab ${token}`;
  }
  return `curl -fsSL ${origin}/api/compute/connect.sh | bash -s -- --service ${token}`;
}

function PairingCard({
  pairing,
  onConnected,
  onClose,
}: {
  pairing: ActivePairing;
  onConnected: (env: ComputeEnvironment) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [liveEnv, setLiveEnv] = useState<ComputeEnvironment>(pairing.environment);
  const announcedRef = useRef(pairing.connectedOnce);

  const command = buildOneLiner(liveEnv.kind, pairing.token);

  useEffect(() => {
    setLiveEnv(pairing.environment);
    announcedRef.current = pairing.connectedOnce;
  }, [pairing]);

  useEffect(() => {
    if (announcedRef.current && liveEnv.online) return;
    const timer = setInterval(() => {
      computeApi
        .test(pairing.environment.id)
        .then(res => {
          setLiveEnv(res.environment);
          if (res.online && !announcedRef.current) {
            announcedRef.current = true;
            toast.success(`${res.environment.name} is now connected!`);
            onConnected(res.environment);
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [pairing.environment.id, liveEnv.online, onConnected]);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success("Connect command copied to clipboard.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy automatically — select and copy the command below.");
    }
  };

  const downloadNotebook = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const nb = await computeApi.notebook(liveEnv.id, pairing.token);
      const blob = new Blob([nb.content], { type: "application/x-ipynb+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nb.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${nb.filename}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't generate notebook."));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="card env-pair-card" aria-live="polite">
      <div className="env-pair-head">
        <div>
          <span className="eyebrow">{COMPUTE_KIND_LABELS[liveEnv.kind]} Setup</span>
          <h3 className="card-title">Connect “{liveEnv.name}”</h3>
        </div>
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>

      {liveEnv.kind === "colab" ? (
        <p className="field-hint env-pair-steps">
          1. Open Google Colab (optionally switch Runtime → Change runtime type → <strong>T4 GPU</strong>), paste this single line into a code cell, and click <strong>Run (▶)</strong>. Zero tunnels or extra accounts needed.
        </p>
      ) : (
        <p className="field-hint env-pair-steps">
          Paste this single command into your server's SSH terminal. It opens zero firewall ports and installs an auto-reconnecting 24/7 background service (<code>curialy-runner</code>).
        </p>
      )}

      <div className="env-cmd-box">
        <pre className="env-cmd-pre"><code>{command}</code></pre>
        <Button variant="primary" size="sm" icon={copied ? Check : Copy} onClick={() => void copyCommand()}>
          {copied ? "Copied" : "Copy command"}
        </Button>
      </div>

      {liveEnv.kind === "colab" && (
        <div className="env-colab-actions">
          <Button size="sm" icon={Download} busy={downloading} onClick={() => void downloadNotebook()}>
            Download ready .ipynb notebook
          </Button>
          <a
            href="https://colab.research.google.com/#create=true"
            target="_blank"
            rel="noopener noreferrer"
            className="btn sm"
          >
            <ExternalLink size={14} aria-hidden="true" />
            <span>Open new Google Colab</span>
          </a>
        </div>
      )}

      <div className="env-pair-status" data-online={liveEnv.online || undefined}>
        {liveEnv.online ? (
          <>
            <span className="dot" data-tone="success" aria-hidden="true" />
            <span>
              <strong>Connected!</strong> {summarizeSpecs(liveEnv.specs)} ({liveEnv.specs?.os ?? "Linux"}) — ready to run your tasks directly.
            </span>
          </>
        ) : (
          <>
            <Spinner size={14} />
            <span>Waiting for your {liveEnv.kind === "colab" ? "Colab cell" : "VPS"} to connect… this updates automatically within seconds.</span>
          </>
        )}
      </div>
    </section>
  );
}

function CreateEnvironmentForm({
  initialKind = "colab",
  onCreated,
  onCancel,
}: {
  initialKind?: ComputeKind;
  onCreated: (res: { environment: ComputeEnvironment; token: string }) => void;
  onCancel?: () => void;
}) {
  const [kind, setKind] = useState<ComputeKind>(initialKind);
  const [name, setName] = useState(initialKind === "colab" ? "Google Colab" : "My VPS");
  const [workDir, setWorkDir] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), workDir: useId(), def: useId() };

  const switchKind = (next: ComputeKind) => {
    setKind(next);
    if (name === "Google Colab" || name === "My VPS" || !name.trim()) {
      setName(next === "colab" ? "Google Colab" : "My VPS");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await computeApi.create({
        kind,
        name: name.trim() || COMPUTE_KIND_LABELS[kind],
        workDir: workDir.trim() || null,
        isDefault,
      });
      onCreated(created);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create compute environment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card env-create-form" onSubmit={event => void submit(event)}>
      <div className="env-pair-head">
        <div>
          <span className="eyebrow">New Environment</span>
          <h3 className="card-title">Connect Google Colab or Your Own VPS</h3>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Environment type</span>
        <RadioGroup.Root
          className="segmented env-kind-seg"
          value={kind}
          onValueChange={val => switchKind(val as ComputeKind)}
          aria-label="Environment type"
        >
          <RadioGroup.Item value="colab">
            <Sparkles size={14} aria-hidden="true" />
            Google Colab (Free RAM &amp; GPU)
          </RadioGroup.Item>
          <RadioGroup.Item value="vps">
            <Terminal size={14} aria-hidden="true" />
            Personal VPS / Linux Server
          </RadioGroup.Item>
        </RadioGroup.Root>
      </div>

      <div className="env-form-grid">
        <div className="field">
          <label className="field-label" htmlFor={ids.name}>Label</label>
          <input
            id={ids.name}
            className="input"
            value={name}
            maxLength={80}
            onChange={e => setName(e.target.value)}
            placeholder={kind === "colab" ? "Google Colab T4" : "Production Ubuntu VPS"}
          />
          <span className="field-hint">Shown in the task composer when selecting where code runs.</span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={ids.workDir}>
            Working directory <span className="field-hint">(optional)</span>
          </label>
          <input
            id={ids.workDir}
            className="input mono"
            value={workDir}
            maxLength={240}
            onChange={e => setWorkDir(e.target.value)}
            placeholder={kind === "colab" ? "/content/curialy-workspaces/<task>" : "~/curialy-workspaces/<task>"}
          />
          <span className="field-hint">Leave blank for clean per-task folders, or enter an existing folder like <code>/srv/app</code>.</span>
        </div>
      </div>

      <div className="env-default-row">
        <div>
          <label className="omni-opt-title" htmlFor={ids.def}>Use by default for new tasks</label>
          <p className="field-hint">If offline when a task starts, Curialy automatically falls back to your built-in sandbox without interrupting you.</p>
        </div>
        <Switch.Root className="switch" id={ids.def} checked={isDefault} onCheckedChange={setIsDefault}>
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      </div>

      {error && (
        <p className="field-error" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="request-actions">
        <Button type="submit" variant="primary" icon={Plus} busy={busy}>
          Generate 1-line connect command
        </Button>
        {onCancel && <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </form>
  );
}

export default function Environments() {
  const account = useAccount();
  const paid = Boolean(account.info?.credits.unlimited || account.info?.credits.plan);
  const [environments, setEnvironments] = useState<ComputeEnvironment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState<ActivePairing | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ComputeEnvironment | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await computeApi.list();
      setEnvironments(res.environments);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Couldn't load compute environments."));
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 10_000);
    return () => clearInterval(poll);
  }, [load]);

  const toggleDefault = async (env: ComputeEnvironment) => {
    setBusyId(env.id);
    try {
      await computeApi.update(env.id, { isDefault: !env.isDefault });
      toast.success(env.isDefault ? "Switched default back to Curialy Built-in Sandbox." : `${env.name} is now your default environment.`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update default environment."));
    } finally {
      setBusyId(null);
    }
  };

  const reconnectEnv = async (env: ComputeEnvironment) => {
    setBusyId(env.id);
    try {
      const rotated = await computeApi.rotate(env.id);
      setPairing({ environment: rotated.environment, token: rotated.token, connectedOnce: false });
      setCreating(false);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't generate connect command."));
    } finally {
      setBusyId(null);
    }
  };

  const checkStatus = async (env: ComputeEnvironment) => {
    setBusyId(env.id);
    try {
      const res = await computeApi.test(env.id);
      await load();
      toast[res.online ? "success" : "info"](
        res.online ? `${env.name} is online (${summarizeSpecs(res.environment.specs)}).` : `${env.name} is currently offline.`,
      );
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't check environment status."));
    } finally {
      setBusyId(null);
    }
  };

  const removeEnv = async (env: ComputeEnvironment) => {
    setBusyId(env.id);
    try {
      await computeApi.remove(env.id);
      if (pairing?.environment.id === env.id) setPairing(null);
      toast.success(`Removed ${env.name}.`);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't remove environment."));
    } finally {
      setBusyId(null);
    }
  };

  const hasCustomDefault = Boolean(environments?.some(e => e.isDefault));

  const actions: TopbarAction[] = [
    {
      id: "connect-env",
      label: "Connect Colab / VPS",
      icon: Plus,
      priority: "primary",
      onSelect: () => {
        setPairing(null);
        setCreating(true);
      },
    },
    {
      id: "refresh-env",
      label: "Refresh",
      icon: RefreshCw,
      priority: "secondary",
      onSelect: () => void load(),
    },
  ];

  return (
    <AppShell title="Compute Environments" topbarActions={actions}>
      <div className="page">
        <div className="page-narrow env-page">
          <header className="page-head">
            <div>
              <span className="eyebrow">Execution Runtime</span>
              <h2 className="page-title">Compute Environments</h2>
              <p className="page-sub">
                Connect a Google Colab runtime (12.7+ GB RAM &amp; free GPUs) or your own Linux VPS so Curialy runs builds, tests, and server tasks directly on your machine — with automatic fallback to Curialy's built-in sandbox whenever your environment is offline.
              </p>
            </div>
          </header>

          {pairing && (
            <PairingCard
              pairing={pairing}
              onConnected={() => void load()}
              onClose={() => setPairing(null)}
            />
          )}

          {(creating || (environments && environments.length === 0 && !pairing)) && (
            <CreateEnvironmentForm
              onCreated={res => {
                setCreating(false);
                setPairing({ environment: res.environment, token: res.token, connectedOnce: false });
                void load();
              }}
              onCancel={environments && environments.length > 0 ? () => setCreating(false) : undefined}
            />
          )}

          <section className="env-section" aria-label="Built-in compute">
            <h3 className="micro env-section-title">Built-in Platform Sandbox</h3>
            <div className="card env-card">
              <div className="env-card-main">
                <div className="env-card-icon">
                  <Server size={18} aria-hidden="true" />
                </div>
                <div className="env-card-body">
                  <div className="env-card-title-row">
                    <strong className="env-card-name">
                      {paid ? "Curialy Dedicated Isolated Compute" : "Curialy Cloud Sandbox"}
                    </strong>
                    <span className="chip" data-tone="success">
                      <span className="dot" data-tone="success" aria-hidden="true" />
                      24/7 Active
                    </span>
                    {!hasCustomDefault && <span className="chip">Default</span>}
                  </div>
                  <p className="env-card-specs">
                    {paid
                      ? "1 GB RAM (+ 1 GB swap) · 1 dedicated CPU · Isolated Linux container · Automatic fallback when custom compute is offline"
                      : "Isolated Linux sandbox · Node.js, Python & Git ready · Automatic fallback when custom compute is offline"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="env-section" aria-label="Connected environments">
            <h3 className="micro env-section-title">Your Connected Environments (Google Colab &amp; VPS)</h3>

            {error && !environments && (
              <StateNotice
                variant="error"
                title="Couldn't load environments"
                actions={<Button icon={RefreshCw} onClick={() => void load()}>Try again</Button>}
              >
                {error}
              </StateNotice>
            )}

            {!error && !environments && (
              <StateNotice variant="loading" title="Loading environments…" />
            )}

            {environments && environments.length > 0 && (
              <div className="env-list">
                {environments.map(env => {
                  const isBusy = busyId === env.id;
                  const specs = env.specs;
                  return (
                    <div key={env.id} className="card env-card" data-online={env.online || undefined}>
                      <div className="env-card-main">
                        <div className="env-card-icon">
                          {env.kind === "colab" ? <Sparkles size={18} aria-hidden="true" /> : <Cpu size={18} aria-hidden="true" />}
                        </div>
                        <div className="env-card-body">
                          <div className="env-card-title-row">
                            <strong className="env-card-name">{env.name}</strong>
                            <span className="chip" data-tone={env.online ? "success" : undefined}>
                              <span className="dot" data-tone={env.online ? "success" : "neutral"} aria-hidden="true" />
                              {env.online ? "Connected" : "Offline"}
                            </span>
                            <span className="chip">{COMPUTE_KIND_LABELS[env.kind]}</span>
                            {env.isDefault && <span className="chip violet">Default</span>}
                            {env.activeTasks > 0 && (
                              <span className="chip mint">
                                {env.activeTasks} running {env.activeTasks === 1 ? "task" : "tasks"}
                              </span>
                            )}
                          </div>
                          <p className="env-card-specs">
                            {specs ? (
                              <>
                                {formatRam(specs.ramMb)} RAM ({formatRam(specs.ramAvailMb)} free) · {specs.cpus} CPU{specs.cpus === 1 ? "" : "s"}
                                {specs.gpu ? ` · ${specs.gpu}` : ""} · {specs.diskFreeGb} GB disk free · {specs.os}
                              </>
                            ) : (
                              "Not connected yet — click Connect command below to pair in one step."
                            )}
                          </p>
                          <p className="env-card-foot">
                            <span>Workspace: <code>{env.workDir ?? (env.kind === "colab" ? "/content/curialy-workspaces/<task>" : "~/curialy-workspaces/<task>")}</code></span>
                            {env.lastSeenAt && <span> · Last seen {relativeTime(env.lastSeenAt)}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="env-card-actions">
                        <Button size="sm" icon={KeyRound} busy={isBusy} onClick={() => void reconnectEnv(env)}>
                          {env.online ? "New command" : "Connect command"}
                        </Button>
                        <Button size="sm" icon={Star} disabled={isBusy} onClick={() => void toggleDefault(env)}>
                          {env.isDefault ? "Unset default" : "Set default"}
                        </Button>
                        <Button size="sm" icon={RefreshCw} disabled={isBusy} onClick={() => void checkStatus(env)}>
                          Check
                        </Button>
                        <Button size="sm" variant="danger" icon={Trash2} disabled={isBusy} onClick={() => setConfirmDelete(env)} aria-label={`Remove ${env.name}`}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={open => { if (!open) setConfirmDelete(null); }}
        title={confirmDelete ? `Remove “${confirmDelete.name}”?` : "Remove environment?"}
        confirmLabel="Remove environment"
        busyLabel="Removing…"
        tone="danger"
        onConfirm={async () => { if (confirmDelete) await removeEnv(confirmDelete); }}
      >
        This immediately revokes its connection token. Future tasks automatically use Curialy's built-in sandbox.
      </ConfirmDialog>
    </AppShell>
  );
}
