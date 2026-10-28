// White-label vocabulary: every user-facing surface speaks in Curialy terms. Vendor identities
// stay in server configuration and logs only.

export const BRAND = {
  core: "Curialy Core",
  relay: "Curialy Relay",
  fast: "Curialy Fast Reasoning",
  research: "Curialy Research Agent",
  browser: "Curialy Live Browser",
  deploy: "Curialy Cloud Deploy",
  vault: "Curialy Vault",
  data: "Curialy Data",
  tuning: "Curialy Tuning",
  sandbox: "Curialy Sandbox",
} as const;

// Ordered so multi-word names are replaced before their parts.
const NAMES: [RegExp, string][] = [
  [/\bSnowflake Cortex\b/gi, BRAND.core],
  [/\bCortex\b/g, BRAND.core],
  [/\b(SNOWFLAKE\.)?CORTEX[A-Z_]*\b/g, "engine setting"],
  [/\bSnowflake\b/gi, BRAND.vault],
  [/\bRelay ?Station\b/gi, BRAND.relay],
  [/\bBrowserbase\b/gi, BRAND.browser],
  [/\bPaper Instruments\b/gi, BRAND.fast],
  [/\b(Thinking Machines )?Tinker\b/g, BRAND.tuning],
  [/\bManus\b/gi, BRAND.research],
  [/\bTiger( Cloud)?\b/g, BRAND.data],
  [/\bTimescale(DB)?\b/g, BRAND.data],
  [/\bRender\b/g, BRAND.deploy],
  [/\bE2B\b/gi, BRAND.sandbox],
];

const VENDOR_HOSTS = /\b(?:https?:\/\/|wss?:\/\/)?[\w.-]*(?:snowflakecomputing\.com|relaystation\.world|browserbase\.com|api\.render\.com|paperinstruments\.com|manus\.(?:ai|im)|tsdb\.cloud\.timescale\.com|timescale\.com|thinkingmachines\.dev|e2b\.(?:app|dev))(?:[/?#][^\s"'<>)]*)?/gi;
const VENDOR_ENV = /\b(SNOWFLAKE_[A-Z_]+|RELAY_API_[A-Z_]+|BROWSERBASE_[A-Z_]+|RENDER_[A-Z_]+|PAPER_API_[A-Z_]+|MANUS_[A-Z_]+|TIGER_[A-Z_]+|TINKER_[A-Z_]+|E2B_[A-Z_]+)\b/g;

/**
 * Scrub vendor names, endpoints and credential variable names from text the platform itself
 * produces (errors, notices, status lines). Not for model output or a project's command output,
 * where words like "Render" can be legitimate content.
 */
export function brandText(text: string) {
  let out = text.replace(VENDOR_HOSTS, "[internal endpoint]").replace(VENDOR_ENV, "engine credential");
  for (const [pattern, replacement] of NAMES) out = out.replace(pattern, replacement);
  return out;
}

/** Engine alias exposed in events instead of the internal provider id. */
export const ENGINE_ALIAS: Record<string, string> = { core: "core", "core-chat": "core", "core-inference": "core", "core-sql": "core", relay: "relay", fast: "fast", research: "research" };
