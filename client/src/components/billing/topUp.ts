// A Developer API top-up amount as the payer types it: whole US dollars within the catalog's limits.

export type TopUpLimits = { minUsd: number; maxUsd: number };
export type TopUpAmount = { ok: true; amountUsd: number } | { ok: false; error: string };

const dollars = (usd: number) => `$${usd.toLocaleString("en-US")}`;

/** "25", "$25", "1,000" and "25.00" are fine; cents, other text and amounts outside the limits are not. */
export function parseTopUp(raw: string, limits: TopUpLimits): TopUpAmount {
  const range = `${dollars(limits.minUsd)} to ${dollars(limits.maxUsd)}`;
  const value = raw.trim().replace(/^\$\s*/, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!value) return { ok: false, error: `Enter an amount from ${range}.` };
  if (/^\d*\.\d*[1-9]\d*$/.test(value)) return { ok: false, error: "Use whole dollars, without cents." };
  if (!/^\d+(\.0*)?$/.test(value)) return { ok: false, error: `Enter whole dollars as digits, from ${range}.` };
  const amountUsd = Number.parseInt(value, 10);
  if (amountUsd < limits.minUsd) return { ok: false, error: `The smallest top-up is ${dollars(limits.minUsd)}.` };
  if (amountUsd > limits.maxUsd) return { ok: false, error: `The largest top-up is ${dollars(limits.maxUsd)}.` };
  return { ok: true, amountUsd };
}
