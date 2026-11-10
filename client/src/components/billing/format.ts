import { formatUsd, microsToUsd } from "@shared/billing";

// Dates as the billing screens show them: the viewer's locale and time zone. Numbers (credits and
// money) in en-US, like the sidebar meter, the credits dialog and every price in the app.

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const shortDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const moment = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const full = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** "9 Dec 2026" */
export const dayText = (iso: string) => day.format(new Date(iso));
/** "9 Dec" */
export const shortDayText = (iso: string) => shortDay.format(new Date(iso));
/** "9 Nov, 4:05 PM" */
export const momentText = (iso: string) => moment.format(new Date(iso));
/** "9 Nov 2026, 4:05 PM" */
export const fullText = (iso: string) => full.format(new Date(iso));

/** Decimals a credit figure keeps: two under 1 (runs are charged to the hundredth), one under 10, none above. */
const creditDecimals = (credits: number) => (Math.abs(credits) < 1 ? 2 : Math.abs(credits) < 10 ? 1 : 0);

/** "6,000", "4.5", "0.03" */
export const creditCount = (credits: number) => credits.toLocaleString("en-US", { maximumFractionDigits: creditDecimals(credits) });

/** Credits that can be spent, cut (never rounded up) to the decimals creditCount shows: 0.96 stays 0.96, 4.97 is 4.9, 4,741.6 is 4,741. */
export function spendableCredits(credits: number) {
  if (!(credits > 0)) return 0;
  const step = 10 ** creditDecimals(credits);
  // The server keeps two decimals; the nudge keeps 0.29 * 100 (28.999…) from flooring to 0.28.
  return Math.floor(credits * step + 1e-6) / step;
}

/** "$12.34" from micro-dollars. */
export const microsText = (micros: number) => formatUsd(microsToUsd(micros));

/** Money that can be spent, cut to the cent (never rounded up): 4,999,999 micro-dollars is "$4.99", not "$5.00". */
export const spendableMicrosText = (micros: number) => formatUsd(micros >= 10_000 ? Math.floor(micros / 10_000) / 100 : microsToUsd(micros));
