import { useCallback, useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Cpu, Plus, Server } from "lucide-react";
import { Link } from "wouter";
import { COMPUTE_KIND_LABELS, summarizeSpecs, type ComputeEnvironment } from "@shared/compute";
import { Tip } from "@/components/common/Tooltip";
import { POPOVER_COLLISION } from "@/components/RepoSelector";
import { computeApi } from "@/lib/api";

const STORAGE_KEY = "curialy.compute.choice";

/** "default" follows whichever environment the account marked as default; "builtin" forces Curialy sandbox; else an environment UUID. */
export type EnvironmentChoice = "default" | "builtin" | string;

export function readEnvironmentChoice(): EnvironmentChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? raw : "default";
  } catch {
    return "default";
  }
}

export function writeEnvironmentChoice(choice: EnvironmentChoice) {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* ignore private-mode storage errors */
  }
}

export function resolveSubmittedEnvironmentId(choice: EnvironmentChoice, envs: ComputeEnvironment[] | null): string | null | undefined {
  if (choice === "builtin") return null;
  if (choice === "default") return undefined;
  if (envs && !envs.some(env => env.id === choice)) return undefined;
  return choice;
}

export function EnvironmentPicker({
  choice,
  onChange,
  onEnvironmentsLoaded,
}: {
  choice: EnvironmentChoice;
  onChange: (next: EnvironmentChoice) => void;
  onEnvironmentsLoaded?: (envs: ComputeEnvironment[]) => void;
}) {
  const [envs, setEnvs] = useState<ComputeEnvironment[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    computeApi.list().then(
      res => {
        setEnvs(res.environments);
        onEnvironmentsLoaded?.(res.environments);
      },
      () => undefined,
    );
  }, [onEnvironmentsLoaded]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const activeEnv =
    !envs || choice === "builtin"
      ? null
      : choice === "default"
        ? envs.find(env => env.isDefault) ?? null
        : envs.find(env => env.id === choice) ?? envs.find(env => env.isDefault) ?? null;

  const select = (next: EnvironmentChoice) => {
    writeEnvironmentChoice(next);
    onChange(next);
    setOpen(false);
  };

  const label = activeEnv ? activeEnv.name : "Compute";
  const tipText = activeEnv
    ? `${activeEnv.name} (${COMPUTE_KIND_LABELS[activeEnv.kind]}) · ${activeEnv.online ? "Online" : "Offline — auto-falls back to Curialy sandbox"}`
    : "Choose where commands run: Curialy sandbox, Google Colab, or your own VPS";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip content={tipText}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="toggle env-pick"
            aria-pressed={Boolean(activeEnv)}
            aria-label={activeEnv ? `Compute environment: ${activeEnv.name}` : "Compute environment: Curialy sandbox"}
          >
            {activeEnv ? (
              <span className="dot" data-tone={activeEnv.online ? "success" : "warning"} aria-hidden="true" />
            ) : (
              <Cpu size={14} aria-hidden="true" />
            )}
            <span className="toggle-label">{label}</span>
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content className="popover env-pick-panel" side="bottom" align="start" sideOffset={8} collisionPadding={POPOVER_COLLISION} aria-label="Compute environment">
          <p className="skill-pick-lead">Where code and terminal commands run for this task.</p>
          <div className="env-pick-list" role="listbox" aria-label="Available environments">
            <button
              type="button"
              role="option"
              aria-selected={!activeEnv}
              className="env-pick-option"
              data-selected={!activeEnv || undefined}
              onClick={() => select("builtin")}
            >
              <Server size={14} className="faint" aria-hidden="true" />
              <span className="env-pick-meta">
                <span className="env-pick-name">Curialy Built-in Sandbox</span>
                <span className="env-pick-sub">Dedicated 1 GB isolated compute (paid) · Cloud sandbox (free)</span>
              </span>
              {!activeEnv && <Check size={14} className="env-pick-check" aria-hidden="true" />}
            </button>

            {envs?.map(env => {
              const selected = activeEnv?.id === env.id;
              return (
                <button
                  key={env.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="env-pick-option"
                  data-selected={selected || undefined}
                  onClick={() => select(env.isDefault ? "default" : env.id)}
                >
                  <span className="dot" data-tone={env.online ? "success" : "neutral"} aria-hidden="true" />
                  <span className="env-pick-meta">
                    <span className="env-pick-name">
                      {env.name}
                      <span className="env-pick-kind">{COMPUTE_KIND_LABELS[env.kind]}</span>
                    </span>
                    <span className="env-pick-sub">
                      {env.online ? `Connected · ${summarizeSpecs(env.specs)}` : "Offline · auto-falls back to built-in"}
                    </span>
                  </span>
                  {selected && <Check size={14} className="env-pick-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="env-pick-foot">
            <Link href="/environments" className="env-pick-manage" onClick={() => setOpen(false)}>
              <Plus size={13} aria-hidden="true" />
              <span>{envs && envs.length > 0 ? "Manage or connect Colab / VPS" : "Connect Google Colab or your own VPS"}</span>
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
