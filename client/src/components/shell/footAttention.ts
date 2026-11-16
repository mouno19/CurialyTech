import type { HealthTone } from "@/lib/appStatus";

// What the closed sidebar footer flags with a dot: anything behind it that needs the user, so
// folding the account and system controls away never hides a problem.

export type FootAttention = { tone: "warning" | "danger"; reasons: string[] } | null;

export function footAttention(input: {
  health: HealthTone;
  /** Credits left (null: not known yet); unlimited: the operator. */
  credits: { available: number; unlimited: boolean } | null;
  githubMissingScopes: boolean;
  vercelReconnect: boolean;
  canvaReconnect: boolean;
}): FootAttention {
  const reasons: string[] = [];
  if (input.health === "danger" || input.health === "warning") reasons.push("system status");
  // The same threshold the credits meter marks as low.
  if (input.credits && !input.credits.unlimited && input.credits.available < 5) reasons.push("credits are low");
  if (input.githubMissingScopes) reasons.push("GitHub needs more access");
  if (input.vercelReconnect) reasons.push("reconnect Vercel");
  if (input.canvaReconnect) reasons.push("reconnect Canva");
  if (!reasons.length) return null;
  return { tone: input.health === "danger" ? "danger" : "warning", reasons };
}
