import fs from "node:fs";

// The country of a visitor from the browser's time zone, read from the system's tz database
// (zone.tab: one country per zone; iso3166.tab: country names). No IP address is looked up or kept.
// Approximate by nature: a zone a few countries share counts for the one tzdata lists it under.

const ZONEINFO = process.env.ZONEINFO_DIR || "/usr/share/zoneinfo";

/** Old names some browsers still report, to the zone tzdata lists now. */
const ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Rangoon": "Asia/Yangon",
  "Asia/Dacca": "Asia/Dhaka", "Asia/Ulan_Bator": "Asia/Ulaanbaatar", "Asia/Chongqing": "Asia/Shanghai", "Asia/Harbin": "Asia/Shanghai",
  "Europe/Kiev": "Europe/Kyiv", "America/Buenos_Aires": "America/Argentina/Buenos_Aires", "America/Indianapolis": "America/Indiana/Indianapolis",
  "Atlantic/Faeroe": "Atlantic/Faroe", "Pacific/Truk": "Pacific/Chuuk", "Pacific/Ponape": "Pacific/Pohnpei", "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago", "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles", "Australia/ACT": "Australia/Sydney",
};

let zones: Map<string, string> | null = null;
let names: Map<string, string> | null = null;

function table(file: string) {
  try {
    return fs.readFileSync(`${ZONEINFO}/${file}`, "utf8").split("\n").filter(line => line && !line.startsWith("#")).map(line => line.split("\t"));
  } catch {
    return [];
  }
}

function load() {
  if (zones && names) return;
  zones = new Map(table("zone.tab").filter(cols => cols[0] && cols[2]).map(cols => [cols[2], cols[0]]));
  names = new Map(table("iso3166.tab").filter(cols => cols[0] && cols[1]).map(cols => [cols[0], cols[1].trim()]));
}

/** Two-letter country code (null: unknown, or a zone such as UTC that isn't a place). */
export function countryForZone(timeZone: string | null | undefined): string | null {
  if (typeof timeZone !== "string" || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(timeZone)) return null;
  load();
  return zones!.get(ALIASES[timeZone] ?? timeZone) ?? null;
}

/** The country from a language tag's region (en-GB → GB), when the time zone says nothing. */
export function countryForLanguage(language: string | null | undefined): string | null {
  const region = typeof language === "string" ? /^[a-z]{2,3}[-_]([A-Z]{2})\b/i.exec(language.trim())?.[1]?.toUpperCase() : undefined;
  if (!region) return null;
  load();
  return names!.has(region) ? region : null;
}

export function countryName(code: string) {
  load();
  return names!.get(code) ?? code;
}
