// User-connected remote compute environments (Google Colab runtimes and personal VPS/Linux servers).
// Shared between the server (tunnel hub, task routing, prompt context) and the client (Environments
// page and composer selector). No runtime dependencies.

export type ComputeKind = "colab" | "vps";
export const COMPUTE_KINDS: ComputeKind[] = ["colab", "vps"];
export const isComputeKind = (value: unknown): value is ComputeKind => value === "colab" || value === "vps";

export const COMPUTE_KIND_LABELS: Record<ComputeKind, string> = {
  colab: "Google Colab",
  vps: "Personal VPS",
};

export const MAX_ENVIRONMENTS_PER_USER = 10;

export type ComputeSpecs = {
  os: string;
  arch: string;
  cpus: number;
  ramMb: number;
  ramAvailMb: number;
  diskFreeGb: number;
  gpu: string | null;
  hostname: string;
  sudo: boolean;
  workBase: string;
};

export type ComputeEnvironment = {
  id: string;
  name: string;
  kind: ComputeKind;
  online: boolean;
  activeTasks: number;
  specs: ComputeSpecs | null;
  /** Optional custom working directory on the remote host (null = per-task folder under workBase). */
  workDir: string | null;
  isDefault: boolean;
  lastSeenAt: string | null;
  createdAt: string;
};

export type CreateComputeEnvironmentRequest = {
  name?: string;
  kind: ComputeKind;
  workDir?: string | null;
  isDefault?: boolean;
};

export type CreateComputeEnvironmentResponse = {
  environment: ComputeEnvironment;
  /** Shown once so the user can paste the 1-line connect command; only its SHA-256 hash is stored. */
  token: string;
};

export function formatRam(ramMb: number): string {
  if (!Number.isFinite(ramMb) || ramMb <= 0) return "—";
  if (ramMb < 1024) return `${Math.round(ramMb)} MB`;
  const gb = ramMb / 1024;
  return `${gb >= 10 ? gb.toFixed(1).replace(/\.0$/, "") : gb.toFixed(1)} GB`;
}

export function summarizeSpecs(specs: ComputeSpecs | null): string {
  if (!specs) return "Waiting for first connection";
  const parts = [`${formatRam(specs.ramMb)} RAM`, `${specs.cpus} CPU${specs.cpus === 1 ? "" : "s"}`];
  if (specs.gpu) parts.push(specs.gpu);
  if (specs.diskFreeGb > 0) parts.push(`${Math.round(specs.diskFreeGb)} GB free`);
  return parts.join(" · ");
}
