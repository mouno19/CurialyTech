// Fixture world for the UI check (scripts/ui-check/run.mjs): one operator ("mouno19"), a task list that
// covers every status, and six task scenarios, in the shapes of the server contract
// (/home/ubuntu/curialy-tools/CONTRACT.md, shared/agent.ts). Nothing here is real data, and nothing
// here imports app code (the client and shared modules are being rewritten in parallel).
// Times are relative to `now`, so "expired", "3h ago" and countdowns stay true on every run.
// Billing (plans, crypto orders, API wallets and usage) lives in billing-fixtures.mjs.
import { deflateSync } from "node:zlib";
import { createBilling } from "./billing-fixtures.mjs";

export const ORIGIN = "https://curialy.test";
export const LOGIN = "mouno19";

/** Every page is scanned for this, in its visible text and in every attribute value. */
export const VENDOR_PATTERN = /snowflake|cortex|relaystation|browserbase|onrender|render\.com|manus|tiger|tinker|paper instruments|token=SECRET/i;

// Leak bait. Legacy logs and deployment rows really carry values like these; the UI must never
// render them (the scan above looks for them). The fixture self-test skips exactly these values.
export const SECRET_LIVE_URL = "https://example.invalid/devtools?token=SECRET";
const SECRET_REPLAY_URL = "https://example.invalid/replay/legacy-session?token=SECRET";
/** What the server stores for a cloud preview today: the hosting provider's own address. */
const vendorDeployUrl = id8 => `https://curialy-preview-${id8}.onrender.com`;
/** A first-party address, for UI_CHECK_DEPLOY_URL=branded (the audit's proposed fix, WL-11). */
const brandedDeployUrl = id8 => `https://curialy-preview-${id8}.preview.curialy.test`;

export const STATUSES = ["queued", "running", "cancelling", "completed", "failed", "cancelled", "interrupted"];
const ACTIVE = new Set(["queued", "running", "cancelling"]);
const RETRYABLE = new Set(["failed", "cancelled", "interrupted"]);

// ---- Ids (UUID-shaped, recognisable in the report) ----

const pad = n => String(n).padStart(2, "0");
const tid = n => `7d3f2a10-4c8e-4b6a-9f21-5e0c8a1b2c${pad(n)}`;
const rid = n => `5b0e7c3a-91d4-4f6e-8a27-0c4d1e9f00${pad(n)}`;
const mid = n => `9c1e5a7b-3d2f-4b8a-a6c4-1e0f2d3c4b${pad(n)}`;
const did = n => `d2a4c6e8-1b3d-4f5a-8c7e-9a0b1c2d3e${pad(n)}`;
const sid = n => `4e8a1c2f-7b3d-4a6e-9c0d-2f1e3a5b7c${pad(n)}`;

export const TASK = {
  running: tid(1), interrupted: tid(2), failed: tid(3), completed: tid(4), chat: tid(5), preview: tid(6),
  queued: tid(7), cancelling: tid(8), issues: tid(9), cancelled: tid(10), redeploy: tid(11),
};

// ---- Long content ----

/** Exactly 120 characters: "owner/name" as GitHub would never allow, to stress every chip and header. */
export const LONG_REPO = `${LOGIN}/enterprise-billing-dashboard-monorepo-with-invoices-reports-analytics-and-multi-currency-ledger-services-emea-v2`;
export const LONG_PDF = "quarterly-revenue-reconciliation-report-for-the-emea-and-apac-regions-final-reviewed-version-2026-10-27.pdf";
const LONG_PNG = "dashboard-overview-after-fixing-the-chart-legend-overflow-on-small-screens-1440x900.png";
const PHONE_PNG = "mobile-360x740-customers-table-with-sticky-header-and-horizontal-scroll-fallback.png";
/** Twelve directories deep. */
export const DEEP_FILE = "frontend/src/features/billing/reports/quarterly/regions/emea/components/charts/legend/overflow/RevenueLegendOverflowFallback.tsx";

/** Deterministic hex (cannot spell any vendor name). */
function hex(length, seed = 7) {
  let x = seed >>> 0;
  let out = "";
  while (out.length < length) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += (x >>> 8).toString(16).padStart(6, "0");
  }
  return out.slice(0, length);
}
/** 300 characters without a break opportunity. */
export const TOKEN_300 = `rk_${hex(297, 11)}`;

// ---- Images (real PNG bytes, so <img> elements decode) ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** A tiny app screenshot: top bar, sidebar, two cards and a bar chart, in the brand's paper tones. */
export function mockScreenshot(width = 160, height = 100) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  const paint = (x, y) => {
    if (y < height * 0.12) return [20, 19, 15];
    if (x < width * 0.18) return [233, 227, 213];
    const inCard = (x0, x1) => x > width * x0 && x < width * x1 && y > height * 0.2 && y < height * 0.55;
    if (inCard(0.22, 0.58) || inCard(0.62, 0.96)) return [248, 245, 238];
    const bar = Math.floor((x - width * 0.22) / (width * 0.07));
    const top = height * (0.95 - 0.06 * ((bar * 37) % 5) - 0.12);
    if (y > height * 0.62 && x > width * 0.22 && x < width * 0.96 && (x - width * 0.22) % (width * 0.07) < width * 0.045 && y > top) return [184, 48, 12];
    return [243, 239, 230];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const offset = y * stride + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
const SCREENSHOT_PNG = mockScreenshot(320, 200);
const SHOT_DATA_URL = `data:image/png;base64,${mockScreenshot(120, 75).toString("base64")}`;
/** What a vault image answers with while storage works (any stored image id). */
const VAULT_PNG = mockScreenshot(240, 150);

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#3a372f"/><text x="48" y="60" font-family="sans-serif" font-size="38" fill="#f3efe6" text-anchor="middle">M</text></svg>`;

// ---- Small HTML pages served inside frames ----

const htmlPage = (title, body, extraCss = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#14130f;background:#f8f5ee}main{max-width:880px;margin:0 auto;padding:28px 24px}
h1{font-size:28px;margin:0 0 8px}p{margin:0 0 12px;color:#3a372f}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:20px}
.card{background:#fff;border:1px solid #d8d0bf;border-radius:10px;padding:14px}code{background:#e9e3d5;padding:1px 4px;border-radius:4px}${extraCss}
</style></head><body><main>${body}</main></body></html>`;

const LIVE_VIEW_HTML = htmlPage("VariableSizeList · react-window docs", `<h1>VariableSizeList</h1>
<p>Renders only the rows that are visible, with a size per row from <code>itemSize(index)</code>.</p>
<div class="cards"><div class="card"><strong>height</strong><p>Height of the list viewport in pixels.</p></div><div class="card"><strong>itemCount</strong><p>Total number of rows.</p></div><div class="card"><strong>itemSize</strong><p>Returns the height of a row.</p></div></div>`);

const PREVIEW_SITE_HTML = htmlPage("Q4 Launch · Curialy fixture site", `<h1>Ship your Q4 launch faster</h1>
<p>Three features, one pricing table and a signup form: the site the Dev Team built in this task.</p>
<div class="cards"><div class="card"><strong>Plan</strong><p>Roadmaps that stay in sync.</p></div><div class="card"><strong>Build</strong><p>Previews on every change.</p></div><div class="card"><strong>Launch</strong><p>One click to go live.</p></div></div>`);

export const externalStubPage = host => htmlPage("External page (fixture)", `<h1>External page</h1><p>The UI check never contacts <code>${host.replace(/[<>&"]/g, "")}</code>; this placeholder stands in for it.</p>`);

/** Clears per-origin storage between checks: no app code runs here. */
export const RESET_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>ui-check</title></head><body><script>try{localStorage.clear();sessionStorage.clear()}catch(e){}</script></body></html>`;

export const FIXTURE_ASSETS = { avatarSvg: AVATAR_SVG, screenshotPng: SCREENSHOT_PNG, liveViewHtml: LIVE_VIEW_HTML, previewSiteHtml: PREVIEW_SITE_HTML };

// ---- Text content ----

const PROMPTS = {
  running: [
    "Refactor the billing dashboard so it stays fast for large accounts.",
    "",
    "1. Split src/billing/components/InvoiceTable.tsx (about 1,800 lines) into InvoiceRows, InvoiceTotals and CurrencyCell. Keep the public props of <InvoiceTable> unchanged so the reports page keeps working.",
    "2. Virtualise the rows: customers with more than 10,000 invoices freeze the tab for several seconds today.",
    "3. Fix the rounding drift from issue #482: totals are off by one cent when an invoice mixes EUR and USD line items.",
    "4. Add vitest coverage for every formatter in src/billing/lib/format.ts, then run the full test suite and a production build before you finish.",
  ].join("\n"),
  interrupted: "Audit the checkout flow on the staging shop: run the end-to-end suite, open the checkout page in the live browser, find out why the Pay button stays disabled for saved cards, and write up the root cause with a proposed fix. Keep a log of every step so the payments team can reproduce it on their machines.",
  failed: "Add a revenue chart to the analytics overview: monthly revenue for the last 12 months as a bar chart, with a currency switcher (EUR/USD/GBP) and a tooltip that shows the exact amount and the month-over-month change. Use the existing formatCurrency helper and make sure npm run build passes.",
  completed: "Build a small analytics dashboard in frontend/ (React + Vite + TypeScript): a revenue chart, a table of the top 20 customers with sorting and search, and a quarterly reconciliation report exported as PDF. Write a README with the setup steps, run the build, and attach the report and screenshots of the dashboard at desktop and phone widths.",
  chat: "Compare the five server-sent events client libraries we shortlisted (native EventSource, eventsource-parser, @microsoft/fetch-event-source, sse.js and eventsource-client) as one table with every column we discussed: version, license, size, reconnect behaviour, Last-Event-ID support, custom headers, retry backoff, Node support, browser support, TypeScript types and notes. Then recommend one for our agent log stream.",
  preview: "Dev Team: build the Q4 launch landing page (hero, three feature cards, a pricing table with a monthly/yearly toggle, an FAQ accordion and a signup form with validation). It must score 95+ on Lighthouse accessibility, work at 360px wide, and pass npm test and npm run build.",
  queued: "Upgrade the monorepo from Node 20 to Node 22: update .nvmrc, the engines fields, the CI images and the Dockerfile, then fix whatever breaks in the test suite.",
  cancelling: "Generate 50k rows of synthetic transaction data for the fraud-detection notebook and profile the feature pipeline; stop if it takes longer than 20 minutes.",
  issues: "Migrate the notification service from callbacks to async/await and add retries with exponential backoff to the email client.",
  cancelled: "Rewrite the image resizing worker in Rust and benchmark it against the current Node implementation on the sample set in fixtures/images.",
  redeploy: "Build a one-page status site for the support team: current incidents, a 90-day uptime bar per service and a subscribe form.",
};

const THINKING_RUNNING = "The table is slow for two reasons: every keystroke in the search box rebuilds filteredInvoices inline, and every row is mounted at once. Splitting first keeps the diff reviewable: InvoiceRows takes the virtualisation, InvoiceTotals owns the currency maths, and CurrencyCell stays a pure formatter.\n\nFor #482 the totals add up per-line amounts that were already rounded in two currencies. Adding in minor units after conversion and rounding once removes the drift; the regression test needs more than 200 mixed lines and a rate with five decimals.";

const TEXT_RUNNING = "The table re-renders every row on each keystroke because `filteredInvoices` is rebuilt inline. I moved the filtering into a `useMemo` keyed on the query and the invoice list, and split the row markup into `InvoiceRows`, which renders through a `VariableSizeList`, so only the visible rows are mounted.\n\nFor the rounding drift in #482, the totals were added up from per-line amounts that had already been rounded in two currencies, so";

const NPM_TEST_OUTPUT = [
  ["stdout", "\n> billing@3.4.0 test\n> vitest run --reporter=verbose src/billing\n\n"],
  ["stderr", "npm WARN deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.\n"],
  ["stdout", " RUN  v2.1.4 /workspace/repo\n\n ✓ src/billing/lib/__tests__/format.currency-rounding.regression-482.test.ts > formatInvoiceTotal > keeps the sum of mixed EUR and USD line items exact to the cent when the exchange rate has more than four decimal places and the invoice has more than two hundred lines (12 ms)\n ✓ src/billing/lib/__tests__/format.test.ts > formatCurrency > formats negative amounts with a leading minus sign (1 ms)\n"],
  ["stdout", ` ✓ src/billing/components/__tests__/InvoiceTable.test.tsx > InvoiceTable > renders 10,000 rows without blocking the main thread (402 ms)\n   Source map: file:///workspace/repo/src/billing/components/invoice-table/InvoiceRows.tsx?import&v=${hex(280, 3)}\n`],
  ["stdout", "\n Test Files  31 passed (31)\n      Tests  214 passed (214)\n   Start at  10:41:07\n   Duration  48.21s (transform 2.10s, setup 0ms, collect 9.84s, tests 31.02s, environment 4.11s, prepare 3.20s)\n"],
];

const E2E_OUTPUT = [
  ["stdout", "Running 14 tests using 2 workers\n\n  ✓  1 [chromium] › e2e/checkout.spec.ts:12:3 › checkout › shows the order summary (2.1s)\n  ✘  2 [chromium] › e2e/checkout.spec.ts:31:3 › checkout › pays with a saved card (30.0s)\n"],
  ["stderr", "    Error: Timed out 30000ms waiting for expect(locator).toBeEnabled()\n    Locator: getByRole('button', { name: 'Pay 129,00 €' })\n    Expected: enabled\n    Received: disabled\n      -   locator resolved to <button disabled type=\"submit\" class=\"pay-button pay-button--primary pay-button--large checkout-step-payment__submit\" data-testid=\"checkout-pay-button\" aria-describedby=\"payment-terms payment-saved-card-hint\">Pay 129,00 €</button>\n"],
  ["stdout", "\n  3 failed\n    [chromium] › e2e/checkout.spec.ts:31:3 › checkout › pays with a saved card\n    [chromium] › e2e/checkout.spec.ts:58:3 › checkout › pays with a saved card after changing the delivery address\n    [chromium] › e2e/checkout.spec.ts:77:3 › checkout › keeps the saved card selected after a failed 3-D Secure challenge\n  11 passed (1.0m)\n"],
];

const TS_ERRORS = [
  "src/components/RevenueChart.tsx(48,17): error TS2322: Type 'string | undefined' is not assignable to type 'number'.",
  "  Type 'undefined' is not assignable to type 'number'.",
  "src/components/RevenueChart.tsx(61,9): error TS2345: Argument of type '{ month: string; revenue: string | undefined; change: number; }[]' is not assignable to parameter of type 'readonly RevenuePoint[]'.",
  "src/lib/format.ts(12,3): error TS7030: Not all code paths return a value.",
  "",
  "Found 3 errors in 2 files.",
].join("\n");

const VITE_BUILD_LOG = [
  "vite v7.1.7 building for production...",
  "transforming...",
  "✓ 2143 modules transformed.",
  "rendering chunks...",
  "computing gzip size...",
  "dist/index.html                              0.64 kB │ gzip:   0.38 kB",
  "dist/assets/index-7hlOrPdg.css              41.27 kB │ gzip:   8.12 kB",
  "dist/assets/vendor-react-Dq8sK2pL.js       142.80 kB │ gzip:  45.90 kB",
  "dist/assets/RevenueChart-BSEziAk6.js        88.15 kB │ gzip:  27.41 kB",
  "dist/assets/index-CiLZHiH9.js              682.41 kB │ gzip: 201.33 kB",
  "(!) Some chunks are larger than 500 kB after minification. Consider:",
  "- Using dynamic import() to code-split the application",
  "✓ built in 9.84s",
].join("\n");

const CHAT_ANSWER = [
  "Here is the comparison, then a recommendation.",
  "",
  "| Library | Version | License | Size (min+gz) | Reconnect | Last-Event-ID | Custom headers | Retry backoff | Node | Browsers | TypeScript | Notes |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  "| Native EventSource | built in | n/a | 0 kB | automatic, fixed delay | yes | no | server `retry:` only | needs a polyfill | all evergreen | lib.dom | GET only; no auth headers, cookies only |",
  "| eventsource-parser | 3.0.6 | MIT | 1.1 kB | none (parser only) | you track it | n/a | n/a | yes | yes | bundled | Pair it with fetch for full control |",
  "| @microsoft/fetch-event-source | 2.0.1 | MIT | 2.3 kB | automatic | yes | yes | configurable | with a fetch polyfill | yes | bundled | Unmaintained since 2021; pauses while the tab is hidden |",
  "| sse.js | 2.5.0 | Apache-2.0 | 2.0 kB | manual | yes | yes | manual | no | yes | community types | XHR based; supports POST bodies |",
  "| eventsource-client | 1.1.3 | MIT | 2.6 kB | automatic | yes | yes | exponential | yes | yes | bundled | Async iterator API; small and maintained |",
  "",
  "**Recommendation:** use `eventsource-client`. It reconnects with exponential backoff, resends `Last-Event-ID`, accepts custom headers, and its async iterator fits the reducer we already have. The native EventSource stays a fine fallback because our stream is same-origin and cookie-authenticated.",
  "",
  "The resume token from the last run, for reference (one unbroken string):",
  "",
  TOKEN_300,
  "",
  "The build log from the bundle-size check:",
  "",
  "```text",
  VITE_BUILD_LOG,
  "```",
].join("\n");

const COMPLETED_ANSWER = [
  "## The analytics dashboard is ready",
  "",
  "Everything lives in `frontend/` (React 19, Vite 7, TypeScript):",
  "",
  "- **Revenue chart**: the last 12 months, with a currency switcher and exact amounts in the tooltip.",
  "- **Top customers**: the top 20 by revenue, sortable and searchable; the table scrolls inside its card on phones.",
  `- **Reconciliation report**: \`reports/${LONG_PDF}\` (attached).`,
  "",
  "Run it with `cd frontend && npm install && npm run dev`. The production build is in `frontend/dist` (37 files, 1.8 MB); `npm run build` and `npm test` both pass.",
].join("\n");

const DEPLOY_ANSWER = "The live preview was up from a temporary private repository and was removed automatically after about 2 hours. Your own repositories were not changed.";

const PREVIEW_ANSWER = [
  "## The Q4 launch page is done",
  "",
  "The Reviewer approved it in round 2. Lighthouse accessibility is **98**, the page works down to 360px, and `npm test` (24 tests) and `npm run build` pass.",
  "",
  "The built site is in `dist/`; the Preview tab shows it.",
].join("\n");

const CODE = {
  invoiceRows: [
    "import { memo } from \"react\";",
    "import { VariableSizeList, type ListChildComponentProps } from \"react-window\";",
    "import type { Invoice } from \"../../types\";",
    "import { CurrencyCell } from \"./CurrencyCell\";",
    "",
    "const ROW_HEIGHT = 44;",
    "",
    "export type InvoiceRowsProps = { invoices: Invoice[]; height: number; onOpen: (id: string) => void };",
    "",
    "function Row({ index, style, data }: ListChildComponentProps<InvoiceRowsProps>) {",
    "  const invoice = data.invoices[index];",
    "  return (",
    "    <div className=\"invoice-row\" style={style} role=\"row\">",
    "      <span role=\"cell\">{invoice.number}</span>",
    "      <span role=\"cell\">{invoice.customer}</span>",
    "      <CurrencyCell amount={invoice.total} currency={invoice.currency} />",
    "    </div>",
    "  );",
    "}",
    "",
    "export const InvoiceRows = memo(function InvoiceRows(props: InvoiceRowsProps) {",
    "  return (",
    "    <VariableSizeList height={props.height} itemCount={props.invoices.length} itemSize={() => ROW_HEIGHT} itemData={props} width=\"100%\">",
    "      {Row}",
    "    </VariableSizeList>",
    "  );",
    "});",
    "",
  ].join("\n"),
  tableBefore: [
    "  const filteredInvoices = invoices.filter(invoice => invoice.customer.toLowerCase().includes(query.toLowerCase()));",
    "  return (",
    "    <table className=\"invoice-table\">",
    "      <tbody>",
    "        {filteredInvoices.map(invoice => (",
    "          <tr key={invoice.id}><td>{invoice.number}</td><td>{invoice.customer}</td><td>{formatCurrency(invoice.total, invoice.currency)}</td></tr>",
    "        ))}",
    "      </tbody>",
    "    </table>",
    "  );",
  ].join("\n"),
  tableAfter: [
    "  const filteredInvoices = useMemo(() => {",
    "    const needle = query.trim().toLowerCase();",
    "    return needle ? invoices.filter(invoice => invoice.customer.toLowerCase().includes(needle)) : invoices;",
    "  }, [invoices, query]);",
    "  return <InvoiceRows invoices={filteredInvoices} height={height} onOpen={onOpen} />;",
  ].join("\n"),
  chart: [
    "import { formatCurrency } from \"../lib/format\";",
    "",
    "export type RevenuePoint = { month: string; revenue: number; change: number };",
    "",
    "export function RevenueChart({ points, currency }: { points: RevenuePoint[]; currency: \"EUR\" | \"USD\" | \"GBP\" }) {",
    "  const max = Math.max(...points.map(point => point.revenue));",
    "  return (",
    "    <figure className=\"revenue-chart\" aria-label=\"Monthly revenue, last 12 months\">",
    "      {points.map(point => (",
    "        <div key={point.month} className=\"bar\" style={{ height: `${(point.revenue / max) * 100}%` }} title={`${point.month}: ${formatCurrency(point.revenue, currency)}`} />",
    "      ))}",
    "    </figure>",
    "  );",
    "}",
    "",
  ].join("\n"),
  deep: [
    "// When the legend has more series than fit, the tail collapses into one \"+N more\" button.",
    "import { useMemo, useState } from \"react\";",
    "",
    "export const LEGEND_FALLBACK_COPY = \"When the chart legend has more series than fit on one line at the current width, the remaining entries collapse into a single '+N more' button that opens a popover listing every series with its colour, its latest value and its share of the total, so nothing is hidden on narrow screens.\";",
    "",
    "export function RevenueLegendOverflowFallback({ series, fit }: { series: { id: string; label: string; color: string }[]; fit: number }) {",
    "  const [open, setOpen] = useState(false);",
    "  const [shown, hidden] = useMemo(() => [series.slice(0, fit), series.slice(fit)], [series, fit]);",
    "  return (",
    "    <div className=\"legend\">",
    "      {shown.map(item => <span key={item.id} className=\"legend-item\" style={{ \"--swatch\": item.color } as React.CSSProperties}>{item.label}</span>)}",
    "      {hidden.length > 0 && <button type=\"button\" aria-expanded={open} onClick={() => setOpen(value => !value)}>+{hidden.length} more</button>}",
    "    </div>",
    "  );",
    "}",
    "",
  ].join("\n"),
  readme: "# Analytics dashboard\n\nA React + Vite + TypeScript dashboard: revenue chart, top customers and the quarterly reconciliation report.\n\n## Setup\n\n```bash\ncd frontend\nnpm install\nnpm run dev\n```\n\n## Build\n\n`npm run build` writes the site to `frontend/dist`.\n",
};

// ---- Builders ----

const iso = ms => new Date(ms).toISOString();
const lineSet = text => new Set(text.split("\n"));
function change(path, kind, before, after) {
  const was = lineSet(before);
  const now = lineSet(after);
  return {
    path, kind, before, after,
    bytesBefore: Buffer.byteLength(before), bytesAfter: Buffer.byteLength(after),
    added: kind === "delete" ? 0 : after.split("\n").filter(line => !was.has(line)).length,
    removed: kind === "create" ? 0 : before.split("\n").filter(line => !now.has(line)).length,
    truncated: false,
  };
}

/** An event log: seq from 1, timestamps from relative gaps, shifted so the last event lands at `endMs`. */
function makeLog() {
  const events = [];
  let t = 0;
  const add = (body, gap = 1800) => {
    t += gap;
    events.push({ ...body, seq: events.length + 1, ts: t });
    return events.length;
  };
  return {
    add,
    tool(callId, name, input, { output = [], changes = [], result = null } = {}) {
      add({ type: "tool_start", callId, name }, 500);
      add({ type: "tool_call", callId, name, input }, 250);
      for (const [stream, chunk] of output) add({ type: "tool_output", callId, stream, chunk }, 1400);
      for (const fileChange of changes) add({ type: "file_change", callId, ...fileChange }, 150);
      if (result) add({ type: "tool_result", callId, durationMs: 1200, ...result }, 400);
    },
    say(blockId, content, { end = true, size = 96 } = {}) {
      add({ type: "text_start", blockId }, 600);
      for (let index = 0; index < content.length; index += size) add({ type: "text_delta", blockId, text: content.slice(index, index + size) }, 90);
      if (end) add({ type: "text_end", blockId }, 60);
    },
    think(blockId, content, ms) {
      add({ type: "thinking_start", blockId }, 300);
      for (let index = 0; index < content.length; index += 160) add({ type: "thinking_delta", blockId, text: content.slice(index, index + 160) }, 120);
      add({ type: "thinking_end", blockId, ms }, 60);
    },
    finish(endMs) {
      const shift = endMs - t;
      return events.map(event => ({ ...event, ts: iso(event.ts + shift) }));
    },
  };
}

function baseRow(id, fields) {
  return {
    id, mode: "agent", model: "claude-opus-5-5", effort: "high", webSearch: false, phase: null,
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }, filesChanged: 0, team: false,
    ...fields,
  };
}

function treeEntries(files, seed = 5) {
  const dirs = new Set();
  for (const file of files) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++) dirs.add(parts.slice(0, index).join("/"));
  }
  let x = seed;
  const size = () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return 180 + (x % 48_000);
  };
  return [
    ...[...dirs].map(path => ({ path, type: "dir", size: 0 })),
    ...files.map(path => ({ path, type: "file", size: size() })),
  ].sort((a, b) => a.path.localeCompare(b.path));
}

// Old logs listed every hashed bundle as an attachment; the UI must group them (shared/generated.ts).
export const BUNDLES = [
  "index-CiLZHiH9.js", "index-7hlOrPdg.css", "vendor-react-Dq8sK2pL.js", "RevenueChart-BSEziAk6.js", "CustomersTable-Xk29PqLm.js",
  "ReportPage-Hn4tW8Zq.js", "charts-Lr7Vb2Ck.js", "date-fns-Qm3Zt9Yx.js", "format-Pc8Nw1Rd.js", "Tooltip-Jv5Ks7Te.js",
  "Dialog-Wb2Hq6Uf.js", "icons-Ty9Mx3Ag.js", "pdf-worker-Fz4Lp8Sh.js", "geist-latin-400-Gk7Rn2Vb.woff2", "geist-latin-600-Ns3Dc5Ym.woff2",
  "logo-Ue6Bq9Wk.svg", "hero-Vd1Jf4Xp.png", "chunk-Rp2Gs8Lc.js", "chunk-Mk5Ht3Qa.js", "polyfills-Zb7Cw1Ne.js",
];
const bundleMeta = name => {
  if (name.endsWith(".css")) return { mimeType: "text/css", kind: "code" };
  if (name.endsWith(".woff2")) return { mimeType: "font/woff2", kind: "other" };
  if (name.endsWith(".svg")) return { mimeType: "image/svg+xml", kind: "image" };
  if (name.endsWith(".png")) return { mimeType: "image/png", kind: "image" };
  return { mimeType: "text/javascript", kind: "code" };
};

// ---- The world ----

/**
 * @param {{ now?: number, deployUrls?: "vendor" | "branded" }} options
 * deployUrls: "vendor" (default) stores the hosting provider's address on deployments, as the server
 * does today; "branded" uses a first-party address instead.
 */
export function createFixtures({ now = Date.now(), deployUrls = "vendor" } = {}) {
  const ago = minutes => iso(now - minutes * 60_000);
  const deployUrl = deployUrls === "branded" ? brandedDeployUrl : vendorDeployUrl;
  const state = { signedIn: true, account: "operator" };
  const tasks = new Map();
  const add = task => tasks.set(task.row.id, task);
  const lastTs = events => events[events.length - 1].ts;

  // (1) Running, streamed live: thinking, tool calls with long output lines, a live browser.
  {
    const id = TASK.running;
    const browser = sid(1);
    const docs = "https://docs.example.com/react-window/variable-size-list";
    const L = makeLog();
    L.add({ type: "run_start", runId: rid(1), attempt: 1, trigger: "prompt" }, 0);
    L.add({ type: "user_message", text: PROMPTS.running, clientMessageId: "m-ui-check-1" }, 40);
    L.add({ type: "status", status: "queued", reason: "prompt" }, 40);
    L.add({ type: "repo", fullName: LONG_REPO, branch: "main", baseSha: "9f2c4e1b7a3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e", repoPath: "repo", url: `https://github.com/${LONG_REPO}` }, 3800);
    L.add({ type: "status", status: "running" }, 400);
    L.add({ type: "dispatch", model: "claude-opus-5-5", provider: "core", reason: "Agent mode with high thinking: the strongest model for a multi-file refactor" }, 300);
    L.add({ type: "phase", phase: "planning", state: "active" }, 100);
    L.add({ type: "turn_start", turn: 1, model: "claude-opus-5-5" }, 200);
    L.think("th-1", THINKING_RUNNING, 6400);
    const plan = [
      { title: "Map InvoiceTable.tsx and its consumers", status: "done" },
      { title: "Split into InvoiceRows, InvoiceTotals and CurrencyCell", status: "in_progress" },
      { title: "Virtualise the rows (10k+ invoices)", status: "pending" },
      { title: "Fix the EUR/USD rounding drift (#482)", status: "pending" },
      { title: "vitest coverage for every formatter; full build", status: "pending" },
    ];
    L.tool("call-plan", "update_plan", { steps: plan }, { result: { ok: true, summary: "Plan updated · 5 steps", durationMs: 14 } });
    L.add({ type: "plan", steps: plan }, 50);
    L.add({ type: "phase", phase: "planning", state: "done", note: "5 steps" });
    L.add({ type: "phase", phase: "deliberation", state: "done", note: "Adaptive reasoning · 6.4 s" }, 100);
    L.add({ type: "phase", phase: "implementation", state: "active" }, 100);
    L.add({ type: "usage", turn: 1, model: "claude-opus-5-5", inputTokens: 48_210, outputTokens: 1830, thinkingTokens: 2210, cacheReadTokens: 30_110 }, 100);
    L.add({ type: "turn_start", turn: 2, model: "claude-opus-5-5" }, 400);
    L.tool("call-1", "run_command", { command: "cd repo && npm ci && npx vitest run --reporter=verbose src/billing", timeout_sec: 300 }, { output: NPM_TEST_OUTPUT, result: { ok: true, summary: "Exit 0 · 214 tests passed", exitCode: 0, durationMs: 48_210 } });
    L.tool("call-2", "read_file", { path: "repo/src/billing/components/InvoiceTable.tsx", start_line: 1, end_line: 400 }, { result: { ok: true, summary: "Read 400 of 1,812 lines", durationMs: 31 } });
    L.tool("call-3", "write_file", { path: "repo/src/billing/components/invoice-table/InvoiceRows.tsx", content: CODE.invoiceRows }, { changes: [change("repo/src/billing/components/invoice-table/InvoiceRows.tsx", "create", "", CODE.invoiceRows)], result: { ok: true, summary: "Created · 28 lines", durationMs: 9 } });
    L.tool("call-4", "edit_file", { path: "repo/src/billing/components/InvoiceTable.tsx", old_string: CODE.tableBefore, new_string: CODE.tableAfter }, { changes: [change("repo/src/billing/components/InvoiceTable.tsx", "modify", CODE.tableBefore, CODE.tableAfter)], result: { ok: true, summary: "Edited · +5 −10", durationMs: 7 } });
    L.add({ type: "tool_start", callId: "call-5", name: "browse" }, 600);
    L.add({ type: "tool_call", callId: "call-5", name: "browse", input: { url: docs, screenshot: true } }, 200);
    L.add({ type: "browser_session", sessionId: browser, status: "live", liveUrl: null, replayUrl: "", viewer: true }, 2400);
    L.add({ type: "browser_action", sessionId: browser, action: "navigate", detail: `Opening ${docs}`, url: docs, title: "" }, 300);
    L.add({ type: "browser_action", sessionId: browser, action: "loaded", detail: "Loaded VariableSizeList · react-window docs", url: docs, title: "VariableSizeList · react-window docs" }, 2100);
    L.add({ type: "media", callId: "call-5", mediaId: null, filename: "browse-variable-size-list.png", mimeType: "image/png", caption: "VariableSizeList · react-window docs", inlineDataUrl: SHOT_DATA_URL }, 400);
    L.add({ type: "tool_result", callId: "call-5", ok: true, summary: "HTTP 200 · no console errors", durationMs: 5300 }, 200);
    L.add({ type: "usage", turn: 2, model: "claude-opus-5-5", inputTokens: 71_402, outputTokens: 3120, thinkingTokens: 1480, cacheReadTokens: 52_990 }, 100);
    // Everything from here arrives live (after the sync's maxSeq), paced by the held-open stream.
    const liveFrom = L.add({ type: "turn_start", turn: 3, model: "claude-opus-5-5" }, 500);
    L.say("tx-1", TEXT_RUNNING, { end: false, size: 48 });
    L.add({ type: "tool_start", callId: "call-6", name: "run_command" }, 500);
    L.add({ type: "tool_input_delta", callId: "call-6", partial: "{\"command\":\"cd repo && npx tsc --noEmit -p tsconfig.json" }, 200);
    L.add({ type: "tool_call", callId: "call-6", name: "run_command", input: { command: "cd repo && npx tsc --noEmit -p tsconfig.json && npx vitest run src/billing", timeout_sec: 300 } }, 300);
    L.add({ type: "tool_output", callId: "call-6", stream: "stdout", chunk: "\n> billing@3.4.0 typecheck\n> tsc --noEmit -p tsconfig.json\n\n" }, 900);
    const events = L.finish(now - 3000);
    add({
      key: "running", title: "Running, streamed live", live: true, liveFrom, events,
      row: baseRow(id, {
        prompt: PROMPTS.running, status: "running", statusReason: "prompt", phase: "implementation", webSearch: true,
        usage: { inputTokens: 119_612, outputTokens: 4950, thinkingTokens: 3690 }, filesChanged: 2,
        githubRepo: LONG_REPO, githubRepoUrl: `https://github.com/${LONG_REPO}`, githubMode: "linked", githubBranch: "main",
        runId: rid(1), attempt: 1, startedAt: events[0].ts, statusChangedAt: events[4].ts, createdAt: events[0].ts, updatedAt: lastTs(events),
      }),
      browsers: { [browser]: { status: "live", viewer: `${ORIGIN}/__fixtures__/live-view/${browser}`, title: "VariableSizeList · react-window docs", url: docs } },
      preview: { available: false, workspace: true, archived: false, build: null, restorable: false, running: true },
      deployments: [],
      exportPlan: { target: { kind: "linked", repo: LONG_REPO, defaultBranch: "main", url: `https://github.com/${LONG_REPO}` }, login: LOGIN },
      tree: { source: "live", files: ["repo/package.json", "repo/tsconfig.json", "repo/src/billing/components/InvoiceTable.tsx", "repo/src/billing/components/invoice-table/InvoiceRows.tsx", "repo/src/billing/lib/format.ts", "repo/src/billing/lib/__tests__/format.currency-rounding.regression-482.test.ts", "repo/src/billing/types.ts", "repo/README.md"] },
    });
  }

  // (2) Interrupted, recovered by old code: a legacy log (no run_start) that ends on status running
  // with a browser session still "live" and a tokenised live-view address; the row says interrupted.
  {
    const id = TASK.interrupted;
    const browser = sid(2);
    const shop = "https://staging-shop.example.com/checkout?step=payment";
    const L = makeLog();
    L.add({ type: "user_message", text: PROMPTS.interrupted }, 0);
    L.add({ type: "status", status: "running" }, 900);
    L.add({ type: "phase", phase: "planning", state: "active" }, 200);
    L.add({ type: "dispatch", model: "claude-sonnet-5-5", provider: "core", reason: "Agent mode with medium thinking" }, 200);
    L.add({ type: "turn_start", turn: 1, model: "claude-sonnet-5-5" }, 200);
    L.say("tx-1", "I'll run the end-to-end suite first, then reproduce the disabled Pay button in the live browser.", { size: 60 });
    L.add({ type: "phase", phase: "planning", state: "done" }, 300);
    L.add({ type: "phase", phase: "implementation", state: "active" }, 100);
    L.tool("call-1", "run_command", { command: "npx playwright test e2e/checkout.spec.ts --project=chromium --reporter=line" }, { output: E2E_OUTPUT, result: { ok: false, summary: "Exit 1 · 3 failed, 11 passed", exitCode: 1, durationMs: 61_240 } });
    L.add({ type: "tool_start", callId: "call-2", name: "browse" }, 800);
    L.add({ type: "tool_call", callId: "call-2", name: "browse", input: { url: shop } }, 200);
    L.add({ type: "browser_session", sessionId: browser, status: "live", liveUrl: SECRET_LIVE_URL, replayUrl: SECRET_REPLAY_URL }, 2600);
    L.add({ type: "browser_action", sessionId: browser, action: "navigate", detail: `Opening ${shop}`, url: shop, title: "" }, 300);
    L.add({ type: "browser_action", sessionId: browser, action: "loaded", detail: "Loaded Checkout · Staging Shop", url: shop, title: "Checkout · Staging Shop" }, 2400);
    L.add({ type: "browser_action", sessionId: browser, action: "click", detail: "Clicked \"Saved cards\"", url: shop, title: "Checkout · Staging Shop" }, 1900);
    L.add({ type: "turn_start", turn: 2, model: "claude-sonnet-5-5" }, 900);
    L.say("tx-2", "The Pay button stays disabled because the saved-card form never reports itself as valid: `isCardComplete` checks the CVC field, which", { end: false, size: 40 });
    L.add({ type: "status", status: "running" }, 1500); // the worker died here; nothing settled the log
    const events = L.finish(now - 2 * 24 * 60 * 60_000);
    add({
      key: "interrupted", title: "Interrupted (legacy restart)", live: false, events,
      row: baseRow(id, {
        prompt: PROMPTS.interrupted, status: "interrupted", statusReason: "server_restart", phase: "implementation", model: "claude-sonnet-5-5", effort: "medium", webSearch: true,
        usage: { inputTokens: 38_420, outputTokens: 2210, thinkingTokens: 0 }, filesChanged: 0,
        statusChangedAt: iso(Date.parse(lastTs(events)) + 4 * 60_000), createdAt: events[0].ts, updatedAt: iso(Date.parse(lastTs(events)) + 4 * 60_000),
      }),
      browsers: { [browser]: { status: "ended" } },
      preview: { available: false, workspace: false, archived: true, build: null, restorable: true, running: false },
      deployments: [],
      exportPlan: { target: { kind: "new", owner: LOGIN, suggestedName: "curialy-audit-the-checkout-flow-on-the-staging-shop" }, files: 3, bytes: 4120, excluded: [], login: LOGIN },
      tree: { source: "archived", files: ["notes/checkout-audit.md", "e2e/checkout.spec.ts", "playwright.config.ts"] },
    });
  }

  // (3) Failed: partial text, failing build output, two self-healing attempts, error + done.
  {
    const id = TASK.failed;
    const L = makeLog();
    L.add({ type: "run_start", runId: rid(3), attempt: 1, trigger: "prompt" }, 0);
    L.add({ type: "user_message", text: PROMPTS.failed, clientMessageId: "m-ui-check-3" }, 40);
    L.add({ type: "status", status: "queued", reason: "prompt" }, 40);
    L.add({ type: "status", status: "running" }, 1200);
    L.add({ type: "phase", phase: "planning", state: "active" }, 100);
    L.add({ type: "turn_start", turn: 1, model: "claude-opus-5-5" }, 200);
    L.say("tx-1", "I'll add the chart as its own component and reuse `formatCurrency` for the axis and the tooltip.", { size: 70 });
    L.add({ type: "phase", phase: "planning", state: "done" }, 100);
    L.add({ type: "phase", phase: "deliberation", state: "done" }, 100);
    L.add({ type: "phase", phase: "implementation", state: "active" }, 100);
    L.tool("call-1", "write_file", { path: "src/components/RevenueChart.tsx", content: CODE.chart }, { changes: [change("src/components/RevenueChart.tsx", "create", "", CODE.chart)], result: { ok: true, summary: "Created · 15 lines", durationMs: 8 } });
    L.tool("call-2", "run_command", { command: "npm run build" }, { output: [["stdout", "\n> analytics@1.8.0 build\n> tsc -b && vite build\n\n"], ["stderr", `${TS_ERRORS}\n`]], result: { ok: false, summary: "Exit 2 · 3 TypeScript errors", exitCode: 2, durationMs: 18_400 } });
    L.add({ type: "phase", phase: "implementation", state: "done" }, 200);
    L.add({ type: "phase", phase: "verification", state: "active" }, 100);
    L.add({ type: "verify_start", iteration: 1, commands: ["npm run build", "npm test"] }, 200);
    L.add({ type: "verify_result", iteration: 1, command: "npm run build", ok: false, exitCode: 2, output: TS_ERRORS, durationMs: 18_400 }, 18_400);
    L.add({ type: "heal", iteration: 1, reason: "Build failed: 3 type errors in RevenueChart.tsx and format.ts", model: "claude-opus-5-5" }, 300);
    L.add({ type: "turn_start", turn: 2, model: "claude-opus-5-5" }, 300);
    L.say("tx-2", "The build still fails because `formatCurrency` returns `string | undefined` for unknown currencies. I narrowed the chart input, but `src/lib/format.ts` has a code path that returns nothing, and changing its signature breaks the invoices page, so", { end: false, size: 64 });
    L.tool("call-3", "run_command", { command: "npm run build" }, { output: [["stderr", `${TS_ERRORS}\n`]], result: { ok: false, summary: "Exit 2 · 3 TypeScript errors", exitCode: 2, durationMs: 17_900 } });
    L.add({ type: "verify_result", iteration: 2, command: "npm run build", ok: false, exitCode: 2, output: TS_ERRORS, durationMs: 17_900 }, 400);
    L.add({ type: "phase", phase: "verification", state: "failed", note: "npm run build still fails after 2 attempts" }, 200);
    const error = "Verification failed after 2 self-healing attempts: npm run build exited with code 2.";
    L.add({ type: "error", message: error }, 100);
    L.add({ type: "done", status: "failed", answer: "", reason: "error", error, outcome: { verification: "failed", failedCheck: { command: "npm run build", exitCode: 2 } } }, 100);
    const events = L.finish(now - 3 * 60 * 60_000);
    add({
      key: "failed", title: "Failed with partial text", live: false, events,
      row: baseRow(id, {
        prompt: PROMPTS.failed, status: "failed", statusReason: "error", error, phase: "verification",
        usage: { inputTokens: 64_310, outputTokens: 5120, thinkingTokens: 2900 }, filesChanged: 1,
        runId: rid(3), attempt: 1, outcome: { verification: "failed", failedCheck: { command: "npm run build", exitCode: 2 } },
        startedAt: events[0].ts, finishedAt: lastTs(events), statusChangedAt: lastTs(events), createdAt: events[0].ts, updatedAt: lastTs(events),
      }),
      browsers: {},
      preview: { available: false, workspace: false, archived: true, build: null, restorable: true, running: false },
      deployments: [],
      exportPlan: { target: { kind: "new", owner: LOGIN, suggestedName: "curialy-add-a-revenue-chart-to-the-analytics-overview" }, files: 9, bytes: 23_410, excluded: [".env"], login: LOGIN },
      tree: { source: "archived", files: ["package.json", "src/components/RevenueChart.tsx", "src/lib/format.ts", "src/pages/Overview.tsx"] },
    });
  }

  // (4) Completed: build, artifacts (3 files + 20 hashed bundles + a generated summary), then a
  // deploy run whose preview went live and expired (the log still says live; the row says expired).
  {
    const id = TASK.completed;
    const deployment = did(4);
    const id8 = id.slice(0, 8);
    const url = deployUrl(id8);
    const L = makeLog();
    L.add({ type: "run_start", runId: rid(4), attempt: 1, trigger: "prompt" }, 0);
    L.add({ type: "user_message", text: PROMPTS.completed, clientMessageId: "m-ui-check-4", attachments: [{ mediaId: mid(30), filename: "brand-guidelines-2026-q4-final-approved-by-design-and-marketing.pdf", mimeType: "application/pdf", sizeBytes: 2_481_904, path: "uploads/brand-guidelines-2026-q4-final-approved-by-design-and-marketing.pdf" }] }, 40);
    L.add({ type: "status", status: "queued", reason: "prompt" }, 40);
    L.add({ type: "status", status: "running" }, 1100);
    L.add({ type: "phase", phase: "planning", state: "active" }, 100);
    L.add({ type: "phase", phase: "planning", state: "done", note: "4 steps" }, 4000);
    L.add({ type: "phase", phase: "deliberation", state: "done" }, 100);
    L.add({ type: "phase", phase: "implementation", state: "active" }, 100);
    L.tool("call-1", "run_command", { command: "npm create vite@latest frontend -- --template react-ts && cd frontend && npm install" }, { output: [["stdout", "Scaffolding project in /workspace/frontend...\n\nDone. Now run:\n\n  cd frontend\n  npm install\n\nadded 214 packages, and audited 215 packages in 21s\n\n41 packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities\n"]], result: { ok: true, summary: "Exit 0", exitCode: 0, durationMs: 24_100 } });
    L.tool("call-2", "write_file", { path: "frontend/src/components/RevenueChart.tsx", content: CODE.chart }, { changes: [change("frontend/src/components/RevenueChart.tsx", "create", "", CODE.chart)], result: { ok: true, summary: "Created · 15 lines", durationMs: 6 } });
    L.tool("call-3", "write_file", { path: DEEP_FILE, content: CODE.deep }, { changes: [change(DEEP_FILE, "create", "", CODE.deep)], result: { ok: true, summary: "Created · 16 lines", durationMs: 6 } });
    L.tool("call-4", "write_file", { path: "README.md", content: CODE.readme }, { changes: [change("README.md", "create", "", CODE.readme)], result: { ok: true, summary: "Created · 17 lines", durationMs: 4 } });
    L.tool("call-5", "run_command", { command: "cd frontend && npm run build" }, { output: [["stdout", `\n> analytics-dashboard@0.1.0 build\n> tsc -b && vite build\n\n${VITE_BUILD_LOG}\n`]], result: { ok: true, summary: "Exit 0 · built in 9.84s", exitCode: 0, durationMs: 14_200 } });
    L.add({ type: "phase", phase: "implementation", state: "done" }, 200);
    L.add({ type: "phase", phase: "verification", state: "active" }, 100);
    L.add({ type: "verify_start", iteration: 1, commands: ["cd frontend && npm run build", "cd frontend && npm test"] }, 200);
    L.add({ type: "verify_result", iteration: 1, command: "cd frontend && npm run build", ok: true, exitCode: 0, output: VITE_BUILD_LOG, durationMs: 14_200 }, 14_200);
    L.add({ type: "verify_result", iteration: 1, command: "cd frontend && npm test", ok: true, exitCode: 0, output: " Test Files  6 passed (6)\n      Tests  38 passed (38)\n", durationMs: 6100 }, 6100);
    L.add({ type: "phase", phase: "verification", state: "done", note: "All 2 checks passed" }, 100);
    L.add({ type: "preview", url: `/api/workspace/preview/${id}/fx-preview-token-4/?dir=frontend%2Fdist`, dir: "frontend/dist", mode: "static" }, 300);
    L.add({ type: "phase", phase: "review", state: "active" }, 100);
    const vault = (n, path, filename, mimeType, sizeBytes, kind, primary) => ({ mediaId: mid(n), source: "vault", path, filename, mimeType, sizeBytes, kind, primary });
    const files = [
      vault(1, `reports/${LONG_PDF}`, LONG_PDF, "application/pdf", 1_284_402, "pdf", true),
      vault(2, `screenshots/${LONG_PNG}`, LONG_PNG, "image/png", 412_118, "image", true),
      { mediaId: null, source: "workspace", path: `screenshots/${PHONE_PNG}`, filename: PHONE_PNG, mimeType: "image/png", sizeBytes: 188_240, kind: "image", primary: false },
      ...BUNDLES.map((name, index) => ({ ...vault(3 + index, `frontend/dist/assets/${name}`, name, bundleMeta(name).mimeType, 4000 + index * 7919, bundleMeta(name).kind, false) })),
    ];
    L.add({ type: "tool_start", callId: "call-6", name: "attach_files" }, 300);
    L.add({ type: "tool_call", callId: "call-6", name: "attach_files", input: { paths: files.slice(0, 3).map(file => file.path), note: "Report and screenshots" } }, 200);
    L.add({ type: "artifacts", files, auto: true, more: 0, skipped: [], generated: { count: 37, bytes: 1_874_220, dirs: [{ dir: "frontend/dist", count: 37 }] } }, 2200);
    L.add({ type: "tool_result", callId: "call-6", ok: true, summary: "Attached 3 files", durationMs: 2100 }, 100);
    L.add({ type: "turn_start", turn: 3, model: "claude-opus-5-5" }, 300);
    L.say("tx-1", COMPLETED_ANSWER, { size: 120 });
    L.add({ type: "phase", phase: "review", state: "done" }, 100);
    L.add({ type: "usage", turn: 3, model: "claude-opus-5-5", inputTokens: 92_104, outputTokens: 7410, thinkingTokens: 3302, cacheReadTokens: 71_880 }, 100);
    L.add({ type: "done", status: "completed", answer: COMPLETED_ANSWER, outcome: { verification: "passed", publish: "not_requested" } }, 100);
    // Run 2: the deploy (system divider, not a user bubble), live with expiresAt now in the past.
    L.add({ type: "run_start", runId: rid(14), attempt: 2, trigger: "deploy" }, 60_000);
    L.add({ type: "user_message", text: "Deploy a live preview" }, 40);
    L.add({ type: "status", status: "queued", reason: "deploy" }, 40);
    L.add({ type: "status", status: "running", reason: "deploy" }, 900);
    L.add({ type: "tool_start", callId: "call-deploy", name: "deploy_preview" }, 400);
    L.add({ type: "tool_call", callId: "call-deploy", name: "deploy_preview", input: { kind: "static", build_command: "cd frontend && npm ci && npm run build", publish_path: "frontend/dist" } }, 200);
    L.add({ type: "deployment", deploymentId: deployment, callId: "call-deploy", status: "creating", detail: `Creating the temporary private repository ${LOGIN}/curialy-preview-${id8}` }, 1500);
    L.add({ type: "deployment", deploymentId: deployment, callId: "call-deploy", status: "building", detail: "Building frontend/dist" }, 9000);
    L.add({ type: "deployment", deploymentId: deployment, callId: "call-deploy", status: "live", url, detail: "Live preview ready", expiresAt: ago(20) }, 70_000);
    L.add({ type: "tool_result", callId: "call-deploy", ok: true, summary: `Live as curialy-preview-${id8} (removed after about 2 hours)`, durationMs: 80_400 }, 300);
    L.say("tx-2", DEPLOY_ANSWER, { size: 120 });
    L.add({ type: "done", status: "completed", answer: DEPLOY_ANSWER, outcome: { verification: "passed", publish: "done" } }, 100);
    const events = L.finish(now - 140 * 60_000);
    const deployStart = events.find(event => event.type === "deployment").ts;
    add({
      key: "completed", title: "Completed: artifacts, expired deploy, archived build", live: false, events,
      row: baseRow(id, {
        prompt: PROMPTS.completed, status: "completed", phase: "review",
        usage: { inputTokens: 184_220, outputTokens: 12_480, thinkingTokens: 6310 }, filesChanged: 41, answer: DEPLOY_ANSWER,
        runId: rid(14), attempt: 2, outcome: { verification: "passed", publish: "done" },
        startedAt: events[0].ts, finishedAt: lastTs(events), statusChangedAt: lastTs(events), createdAt: events[0].ts, updatedAt: lastTs(events),
      }),
      browsers: {},
      preview: { available: false, workspace: false, archived: true, build: { dir: "frontend/dist", fileCount: 37, bytes: 1_874_220, kind: "build" }, restorable: true, running: false },
      deployments: [{
        id: deployment, callId: "call-deploy", state: "expired", url, detail: "Live preview ready",
        target: { kind: "temp_repo", repo: `${LOGIN}/curialy-preview-${id8}`, private: true },
        createdAt: deployStart, expiresAt: ago(20), removedAt: ago(18), removedReason: "expired", canRemove: false,
      }],
      exportPlan: { target: { kind: "new", owner: LOGIN, suggestedName: "curialy-build-a-small-analytics-dashboard-in-frontend" }, files: 41, bytes: 186_402, excluded: [".env", "frontend/.env.local"], login: LOGIN },
      tree: {
        source: "archived",
        files: [
          "README.md", ".gitignore", "frontend/package.json", "frontend/package-lock.json", "frontend/tsconfig.json", "frontend/vite.config.ts", "frontend/index.html",
          "frontend/src/main.tsx", "frontend/src/App.tsx", "frontend/src/components/RevenueChart.tsx", "frontend/src/components/CustomersTable.tsx", "frontend/src/lib/format.ts",
          DEEP_FILE, `reports/${LONG_PDF}`, `screenshots/${LONG_PNG}`, `screenshots/${PHONE_PNG}`,
          "frontend/dist/index.html", ...BUNDLES.map(name => `frontend/dist/assets/${name}`),
          "coverage/lcov-report/index.html", "coverage/lcov.info",
        ],
      },
    });
  }

  // (5) Chat answer with a 12-column table, a 300-character token and a build log code block.
  {
    const id = TASK.chat;
    const L = makeLog();
    L.add({ type: "run_start", runId: rid(5), attempt: 1, trigger: "prompt" }, 0);
    L.add({ type: "user_message", text: PROMPTS.chat, clientMessageId: "m-ui-check-5" }, 40);
    L.add({ type: "status", status: "queued", reason: "prompt" }, 40);
    L.add({ type: "status", status: "running" }, 700);
    L.add({ type: "dispatch", model: "claude-sonnet-5-5", provider: "core", reason: "Chat mode" }, 100);
    L.add({ type: "turn_start", turn: 1, model: "claude-sonnet-5-5" }, 100);
    L.think("th-1", "Five libraries, twelve columns; the deciding factors for an agent log stream are reconnect with Last-Event-ID, cookie auth and maintenance status.", 2100);
    L.say("tx-1", CHAT_ANSWER, { size: 140 });
    L.add({ type: "usage", turn: 1, model: "claude-sonnet-5-5", inputTokens: 3120, outputTokens: 1460, thinkingTokens: 220, cacheReadTokens: 0 }, 100);
    L.add({ type: "done", status: "completed", answer: CHAT_ANSWER, outcome: { verification: "none" } }, 100);
    const events = L.finish(now - 26 * 60_000);
    add({
      key: "chat", title: "Chat answer: wide table, long token, build log", live: false, events,
      row: baseRow(id, {
        prompt: PROMPTS.chat, status: "completed", mode: "chat", model: "claude-sonnet-5-5", effort: "medium",
        usage: { inputTokens: 3120, outputTokens: 1460, thinkingTokens: 220 }, answer: CHAT_ANSWER,
        runId: rid(5), attempt: 1, outcome: { verification: "none" },
        startedAt: events[0].ts, finishedAt: lastTs(events), statusChangedAt: lastTs(events), createdAt: events[0].ts, updatedAt: lastTs(events),
      }),
      browsers: {},
      preview: { available: false, workspace: false, archived: false, build: null, restorable: false, running: false },
      deployments: [],
      exportPlan: { target: { kind: "new", owner: LOGIN, suggestedName: "curialy-compare-the-five-server-sent-events-client" }, files: 0, bytes: 0, excluded: [], login: LOGIN },
      tree: { source: "archived", files: [] },
    });
  }

  // (6) Not in the brief's list, added on purpose: a clean Dev Team success with an available
  // workspace preview and a live cloud preview. It is the only scenario that reaches the Preview
  // tab default, the preview frame and a live deployment (white-label: its href/src).
  {
    const id = TASK.preview;
    const deployment = did(6);
    const id8 = id.slice(0, 8);
    const url = deployUrl(id8);
    const L = makeLog();
    L.add({ type: "run_start", runId: rid(6), attempt: 1, trigger: "prompt" }, 0);
    L.add({ type: "user_message", text: PROMPTS.preview, clientMessageId: "m-ui-check-6" }, 40);
    L.add({ type: "status", status: "queued", reason: "prompt" }, 40);
    L.add({ type: "status", status: "running" }, 900);
    L.add({ type: "team_agent", role: "architect", status: "working", model: "claude-opus-5-5", activity: "Planning the landing page" }, 200);
    L.add({ type: "phase", phase: "planning", state: "active" }, 100);
    L.add({ type: "handoff", from: "architect", to: "engineer", kind: "plan", title: "Plan: Q4 launch landing page (6 steps)", content: "1. Hero with the launch headline and one primary action\n2. Three feature cards in a responsive grid\n3. Pricing table with a monthly/yearly toggle (aria-pressed)\n4. FAQ accordion built on <details>\n5. Signup form with inline validation and an error summary\n6. Lighthouse and 360px checks before review" }, 9000);
    L.add({ type: "team_agent", role: "architect", status: "done", model: "claude-opus-5-5", activity: "Plan handed to the Engineer" }, 100);
    L.add({ type: "team_agent", role: "engineer", status: "working", model: "claude-sonnet-5-5", activity: "Building the page" }, 100);
    L.add({ type: "phase", phase: "planning", state: "done" }, 100);
    L.add({ type: "phase", phase: "implementation", state: "active" }, 100);
    L.tool("call-1", "run_command", { command: "npm run build" }, { output: [["stdout", `${VITE_BUILD_LOG}\n`]], result: { ok: true, summary: "Exit 0 · built in 9.84s", exitCode: 0, durationMs: 11_900 } });
    L.add({ type: "handoff", from: "reviewer", to: "engineer", kind: "review", round: 1, title: "Changes requested: 2 issues", content: "- **major** `src/Pricing.tsx`: the monthly/yearly toggle has no accessible state; use aria-pressed.\n- **minor** `src/Signup.tsx`: errors are not announced; add an error summary with role=alert." }, 30_000);
    L.add({ type: "handoff", from: "engineer", to: "reviewer", kind: "fixes", round: 1, title: "Fixed both issues", content: "Added aria-pressed to the toggle and an error summary (role=alert) that focuses on submit." }, 40_000);
    L.add({ type: "team_agent", role: "engineer", status: "done", model: "claude-sonnet-5-5", activity: "Fixes handed back" }, 100);
    L.add({ type: "team_agent", role: "reviewer", status: "done", model: "claude-opus-5", activity: "Approved in round 2" }, 20_000);
    L.add({ type: "phase", phase: "implementation", state: "done" }, 100);
    L.add({ type: "phase", phase: "verification", state: "done", note: "All 2 checks passed" }, 100);
    L.add({ type: "preview", url: `/api/workspace/preview/${id}/fx-preview-token-6/?dir=dist`, dir: "dist", mode: "static" }, 200);
    L.add({ type: "handoff", from: "reviewer", to: "user", kind: "report", title: "Approved: ready to ship", content: PREVIEW_ANSWER }, 300);
    L.say("tx-1", PREVIEW_ANSWER, { size: 120 });
    L.add({ type: "phase", phase: "review", state: "done" }, 100);
    L.add({ type: "done", status: "completed", answer: PREVIEW_ANSWER, outcome: { verification: "passed", review: { verdict: "approve", rounds: 2 }, publish: "not_requested" } }, 100);
    L.add({ type: "run_start", runId: rid(16), attempt: 2, trigger: "deploy" }, 120_000);
    L.add({ type: "user_message", text: "Deploy a live preview" }, 40);
    L.add({ type: "status", status: "queued", reason: "deploy" }, 40);
    L.add({ type: "status", status: "running", reason: "deploy" }, 900);
    L.add({ type: "tool_start", callId: "call-deploy", name: "deploy_preview" }, 400);
    L.add({ type: "tool_call", callId: "call-deploy", name: "deploy_preview", input: { kind: "static", build_command: "npm ci && npm run build", publish_path: "dist" } }, 200);
    L.add({ type: "deployment", deploymentId: deployment, callId: "call-deploy", status: "creating", detail: `Creating the temporary private repository ${LOGIN}/curialy-preview-${id8}` }, 1500);
    L.add({ type: "deployment", deploymentId: deployment, callId: "call-deploy", status: "building", detail: "Building dist" }, 8000);
    L.add({ type: "deployment", deploymentId: deployment, callId: "call-deploy", status: "live", url, detail: "Live preview ready", expiresAt: ago(-95) }, 60_000);
    L.add({ type: "tool_result", callId: "call-deploy", ok: true, summary: `Live as curialy-preview-${id8} (removed after about 2 hours)`, durationMs: 69_000 }, 300);
    L.add({ type: "done", status: "completed", answer: "The live preview is up; it is removed automatically after about 2 hours.", outcome: { verification: "passed", publish: "done" } }, 100);
    const events = L.finish(now - 25 * 60_000);
    add({
      key: "preview", title: "Completed Dev Team run: available preview, live deploy", live: false, events,
      row: baseRow(id, {
        prompt: PROMPTS.preview, status: "completed", phase: "review", team: true,
        usage: { inputTokens: 241_880, outputTokens: 19_204, thinkingTokens: 8840 }, filesChanged: 14, answer: "The live preview is up; it is removed automatically after about 2 hours.",
        githubRepo: `${LOGIN}/q4-launch-landing`, githubRepoUrl: `https://github.com/${LOGIN}/q4-launch-landing`, githubMode: "export", githubPushedAt: ago(27),
        runId: rid(16), attempt: 2, outcome: { verification: "passed", publish: "done" },
        startedAt: events[0].ts, finishedAt: lastTs(events), statusChangedAt: lastTs(events), createdAt: events[0].ts, updatedAt: lastTs(events),
      }),
      browsers: {},
      preview: { available: true, workspace: true, dir: "dist", url: `/api/workspace/preview/${id}/fx-preview-token-6/?dir=dist`, warnings: ["2 asset links start with / and may not load inside the preview (index.html: /favicon.ico, /og-image.png)."] },
      deployments: [{
        id: deployment, callId: "call-deploy", state: "live", url, detail: "Live preview ready",
        target: { kind: "temp_repo", repo: `${LOGIN}/curialy-preview-${id8}`, private: true },
        createdAt: events.find(event => event.type === "deployment").ts, expiresAt: ago(-95), removedAt: null, removedReason: null, canRemove: true,
      }],
      exportPlan: { target: { kind: "existing", repo: `${LOGIN}/q4-launch-landing`, url: `https://github.com/${LOGIN}/q4-launch-landing`, branch: "main", remote: "changed" }, files: 14, bytes: 48_240, excluded: [], login: LOGIN },
      tree: { source: "live", files: ["package.json", "index.html", "src/main.tsx", "src/Hero.tsx", "src/Pricing.tsx", "src/Signup.tsx", "src/Faq.tsx", "dist/index.html", "dist/assets/index-Qw8Er2Ty.js", "dist/assets/index-Ui9Op3As.css"] },
    });
  }

  // List-only rows (the Tasks list must cover every status): queued, cancelling, completed with a
  // failed check, cancelled. Their pages work too, with short logs.
  const short = (key, status, fields, bodies, endMinutesAgo) => {
    const L = makeLog();
    for (const body of bodies) L.add(body, 1500);
    const events = L.finish(now - endMinutesAgo * 60_000);
    const final = !ACTIVE.has(status);
    add({
      key, title: key, live: false, listOnly: true, events,
      row: baseRow(TASK[key], { prompt: PROMPTS[key], status, ...fields, startedAt: events[0].ts, ...(final ? { finishedAt: lastTs(events) } : {}), statusChangedAt: lastTs(events), createdAt: events[0].ts, updatedAt: lastTs(events) }),
      browsers: {},
      preview: { available: false, workspace: !final, archived: final, build: null, restorable: final, running: false },
      deployments: [],
      exportPlan: { target: { kind: "new", owner: LOGIN, suggestedName: `curialy-${key}` }, files: 2, bytes: 1800, excluded: [], login: LOGIN },
      tree: { source: final ? "archived" : "live", files: ["package.json", "README.md"] },
    });
  };
  short("queued", "queued", { statusReason: "prompt", runId: rid(7), attempt: 1, model: "claude-sonnet-5-5" }, [
    { type: "run_start", runId: rid(7), attempt: 1, trigger: "prompt" },
    { type: "user_message", text: PROMPTS.queued },
    { type: "status", status: "queued", reason: "prompt" },
  ], 0.5);
  short("cancelling", "cancelling", { statusReason: "user_cancel", cancelRequested: true, runId: rid(8), attempt: 1, webSearch: true, usage: { inputTokens: 12_400, outputTokens: 820, thinkingTokens: 0 } }, [
    { type: "run_start", runId: rid(8), attempt: 1, trigger: "prompt" },
    { type: "user_message", text: PROMPTS.cancelling },
    { type: "status", status: "queued", reason: "prompt" },
    { type: "status", status: "running" },
    { type: "status", status: "cancelling", reason: "user_cancel" },
  ], 1);
  short("issues", "completed", { outcome: { verification: "failed", failedCheck: { command: "npm test -- --run notifications", exitCode: 1 } }, runId: rid(9), attempt: 1, filesChanged: 6, usage: { inputTokens: 58_200, outputTokens: 4410, thinkingTokens: 1900 }, answer: "Migrated the notification service to async/await with retries. One test still fails: the email client mock does not reset between retries." }, [
    { type: "run_start", runId: rid(9), attempt: 1, trigger: "prompt" },
    { type: "user_message", text: PROMPTS.issues },
    { type: "status", status: "running" },
    { type: "verify_result", iteration: 1, command: "npm test -- --run notifications", ok: false, exitCode: 1, output: "FAIL src/notifications/email.test.ts > retries > stops after 5 attempts\nAssertionError: expected 6 calls to be 5", durationMs: 8400 },
    { type: "done", status: "completed", answer: "Migrated the notification service to async/await with retries. One test still fails: the email client mock does not reset between retries.", outcome: { verification: "failed", failedCheck: { command: "npm test -- --run notifications", exitCode: 1 } } },
  ], 75);
  short("cancelled", "cancelled", { statusReason: "user_cancel", runId: rid(10), attempt: 1, usage: { inputTokens: 9100, outputTokens: 610, thinkingTokens: 0 } }, [
    { type: "run_start", runId: rid(10), attempt: 1, trigger: "prompt" },
    { type: "user_message", text: PROMPTS.cancelled },
    { type: "status", status: "running" },
    { type: "status", status: "cancelling", reason: "user_cancel" },
    { type: "done", status: "cancelled", answer: "", reason: "user_cancel" },
  ], 300);
  // A failed Deploy run: it can't be retried (a retry has no deploy grant), so it offers "Deploy again".
  const deployError = "Deploy build failed. Check the build and start commands.";
  short("redeploy", "failed", { statusReason: "error", error: deployError, runId: rid(18), attempt: 2, filesChanged: 3, outcome: { verification: "none", publish: "failed" }, usage: { inputTokens: 21_300, outputTokens: 1240, thinkingTokens: 0 } }, [
    { type: "run_start", runId: rid(17), attempt: 1, trigger: "prompt" },
    { type: "user_message", text: PROMPTS.redeploy },
    { type: "status", status: "running" },
    { type: "done", status: "completed", answer: "The status site is in the workspace: index.html, styles.css and app.js.", outcome: { verification: "none" } },
    { type: "run_start", runId: rid(18), attempt: 2, trigger: "deploy" },
    { type: "user_message", text: "Deploy a live preview" },
    { type: "status", status: "queued", reason: "deploy" },
    { type: "status", status: "running" },
    { type: "tool_start", callId: "call-redeploy", name: "deploy_preview" },
    { type: "tool_call", callId: "call-redeploy", name: "deploy_preview", input: { kind: "static" } },
    { type: "tool_result", callId: "call-redeploy", ok: false, summary: "Deploy failed", durationMs: 41_000 },
    { type: "error", message: deployError },
    { type: "done", status: "failed", answer: "", reason: "error", error: deployError, outcome: { verification: "none", publish: "failed" } },
  ], 40);

  // ---- App-wide data ----

  const providers = [
    { id: "data", label: "Curialy Data", ok: true, latencyMs: 41, detail: "Database connected", configured: true },
    { id: "core", label: "Curialy Core", ok: true, latencyMs: 212, detail: "Reasoning engine reachable", configured: true },
    { id: "relay", label: "Curialy Relay", ok: true, latencyMs: 388, detail: "42 model routes available", configured: true },
    // One service degraded (transient: configured, failing).
    { id: "research", label: "Curialy Research Agent", ok: false, latencyMs: 8004, detail: "The agent service did not answer within 8 seconds.", configured: true },
    { id: "fast", label: "Curialy Fast Reasoning", ok: true, latencyMs: 164, detail: "3 model(s) ready", configured: true },
    { id: "browser", label: "Curialy Live Browser", ok: true, latencyMs: 297, detail: "Ready · up to 3 concurrent sessions", configured: true },
    { id: "deploy", label: "Curialy Cloud Deploy", ok: true, latencyMs: 251, detail: "Ready (deploys need GitHub connected)", configured: true },
    { id: "voice", label: "Curialy Voice", ok: true, latencyMs: 188, detail: "Ready: dictation, transcripts and narration", configured: true },
    { id: "voice-studio", label: "Curialy Voice Studio", ok: true, latencyMs: 0, detail: "Ready for expressive speech (operator only)", configured: true },
    { id: "gemini", label: "Gemini engine", ok: true, latencyMs: 0, detail: "Routed (run the live check to verify)", configured: true },
    // File storage not set up (needs an operator; the client must not poll faster for it).
    { id: "vault", label: "Curialy Vault (media)", ok: false, latencyMs: 0, detail: "File storage is not set up yet: the storage location is missing or this server may not use it. An operator needs to run the storage setup.", configured: true },
  ];
  const storage = { ok: false, state: "unavailable", kind: "stage_missing", retryAfter: 30, detail: providers.at(-1).detail };
  const rows = [...tasks.values()].map(task => task.row);
  const count = status => rows.filter(row => row.status === status).length;
  const stats = {
    total: rows.length, completed: count("completed"), failed: count("failed"), cancelled: count("cancelled"), interrupted: count("interrupted"),
    running: count("running"), filesChanged: rows.reduce((sum, row) => sum + row.filesChanged, 0), active: rows.filter(row => ACTIVE.has(row.status)).length,
  };
  const models = [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "core", group: "Core", tools: true, thinking: "adaptive-summarized", effort: true, eagerInput: true, vision: true },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "core", group: "Core", tools: true, thinking: "adaptive-summarized", effort: true, eagerInput: true, vision: true },
    { id: "openai-gpt-5.5", label: "OpenAI GPT 5.5", provider: "core-chat", group: "Core", tools: true, thinking: "none", effort: true, eagerInput: false, vision: true },
    { id: "r/gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "relay", group: "Gemini", tools: true, thinking: "none", effort: false, eagerInput: false, vision: true, variants: { low: "r/gemini-3.8-flash-low", medium: "r/gemini-3.8-flash-medium", high: "r/gemini-3.8-flash-high" } },
    { id: "llama3.3-70b", label: "Llama 3.3 70B", provider: "core-sql", group: "Core", tools: false, thinking: "none", effort: false, eagerInput: false, vision: false },
  ];
  const keys = [
    { id: "core", label: "Curialy Core engine", configured: true, masked: "••••q7Zk" },
    { id: "fast", label: "Fast Reasoning engine", configured: true, masked: "••••3f9a" },
    { id: "relay", label: "Relay engine (Claude & Gemini routes)", configured: true, masked: "••••Lp21" },
    { id: "research", label: "Research Agent", configured: true, masked: "••••8c0e" },
    { id: "browser", label: "Live Browser", configured: true, masked: "••••d4b7" },
    { id: "deploy", label: "Cloud Deploy", configured: true, masked: "••••Wq5e" },
    { id: "data", label: "Curialy Data (database)", configured: true, masked: "connected" },
    { id: "vault", label: "Curialy Vault (media storage)", configured: true, masked: "set" },
    { id: "tuning", label: "Model tuning", configured: false, masked: null, note: "Stored for fine-tuning; no tuned models are routable yet." },
    { id: "github-oauth", label: "GitHub app", configured: true, masked: "••••e1c2", note: "Connected-account tokens are stored encrypted (AES-256-GCM)." },
    { id: "session", label: "Session signing secret", configured: true, masked: "set" },
    { id: "admin", label: "Admin password", configured: true, masked: "scrypt hash" },
  ];
  const github = {
    configured: true, connected: true, login: LOGIN, name: "Mouno", avatarUrl: "https://avatars.githubusercontent.com/u/9919?v=4",
    scopes: ["repo", "read:user"], missingScopes: [], connectedAt: ago(12 * 24 * 60),
  };
  const repo = (n, fullName, description, language, minutes, priv = true) => ({ id: 81_000 + n, name: fullName.split("/")[1], full_name: fullName, private: priv, default_branch: "main", description, updated_at: ago(minutes), language });
  const repos = {
    login: LOGIN,
    repos: [
      repo(1, LONG_REPO, "Invoices, reports and analytics for every currency we bill in, with the ledger services that reconcile them nightly across the EMEA and APAC entities.", "TypeScript", 30),
      repo(2, `${LOGIN}/q4-launch-landing`, "Q4 launch landing page", "TypeScript", 40, false),
      repo(3, `${LOGIN}/staging-shop`, null, "TypeScript", 2 * 24 * 60),
      repo(4, `${LOGIN}/notification-service`, "Email, SMS and push notifications", "TypeScript", 3 * 24 * 60),
      repo(5, `${LOGIN}/image-resizer`, "Thumbnail worker", "Rust", 9 * 24 * 60, false),
      repo(6, `${LOGIN}/fraud-detection-notebooks`, "Feature pipeline experiments", "Python", 20 * 24 * 60),
    ],
  };
  const media = [
    { id: mid(1), filename: LONG_PDF, mimeType: "application/pdf", sizeBytes: 1_284_402, kind: "artifact", sessionId: TASK.completed, createdAt: ago(150), state: "stored" },
    { id: mid(2), filename: LONG_PNG, mimeType: "image/png", sizeBytes: 412_118, kind: "artifact", sessionId: TASK.completed, createdAt: ago(150), state: "stored" },
    { id: mid(30), filename: "brand-guidelines-2026-q4-final-approved-by-design-and-marketing.pdf", mimeType: "application/pdf", sizeBytes: 2_481_904, kind: "upload", sessionId: TASK.completed, createdAt: ago(160), state: "stored" },
    { id: mid(31), filename: "checkout-saved-card-disabled-pay-button-staging-2026-10-25.png", mimeType: "image/png", sizeBytes: 301_772, kind: "screenshot", sessionId: TASK.interrupted, createdAt: ago(2 * 24 * 60), state: "stored" },
    { id: mid(32), filename: "screenshot-20261025-114512-variable-size-list-docs-page-after-scrolling-to-the-api-section.png", mimeType: "image/png", sizeBytes: 220_104, kind: "screenshot", sessionId: TASK.running, createdAt: ago(3), state: "stored" },
    { id: mid(33), filename: "invoices-sample-10k.csv", mimeType: "text/csv", sizeBytes: 1_904_331, kind: "upload", sessionId: TASK.running, createdAt: ago(8), state: "stored" },
    { id: mid(34), filename: "q4-launch-hero@2x.png", mimeType: "image/png", sizeBytes: 822_610, kind: "artifact", sessionId: TASK.preview, createdAt: ago(30), state: "missing" },
    { id: mid(35), filename: "lighthouse-report.html", mimeType: "text/html", sizeBytes: 402_118, kind: "artifact", sessionId: TASK.preview, createdAt: ago(30), state: "stored" },
    { id: mid(36), filename: "architecture-notes.md", mimeType: "text/markdown", sizeBytes: 8_204, kind: "upload", sessionId: null, createdAt: ago(5 * 24 * 60), state: "stored" },
    { id: mid(37), filename: "revenue-by-month.json", mimeType: "application/json", sizeBytes: 3_311, kind: "artifact", sessionId: TASK.failed, createdAt: ago(190), state: "stored" },
    { id: mid(38), filename: "team-photo-offsite.jpg", mimeType: "image/jpeg", sizeBytes: 3_904_112, kind: "upload", sessionId: null, createdAt: ago(9 * 24 * 60), state: "stored" },
    { id: mid(39), filename: "release-checklist.pdf", mimeType: "application/pdf", sizeBytes: 94_220, kind: "upload", sessionId: null, createdAt: ago(14 * 24 * 60), state: "missing" },
  ];
  // What each signed-in account's vault holds (the list, the totals, the limit, storage health).
  const storageOk = { ok: true, state: "ok", kind: null, retryAfter: 0, detail: "File storage is ready." };
  const kindCount = (files, kind) => files.filter(file => file.kind === kind).length;
  const vaults = {
    operator: {
      files: media, more: false, storage,
      summary: { total: media.length, byKind: { upload: kindCount(media, "upload"), screenshot: kindCount(media, "screenshot"), artifact: kindCount(media, "artifact") }, usedBytes: media.filter(file => file.state !== "missing").reduce((sum, file) => sum + file.sizeBytes, 0), usedFiles: media.filter(file => file.state !== "missing").length },
      quota: { unlimited: true, reason: "operator", plan: null, maxBytes: null, maxFiles: null },
    },
    free: {
      files: media, more: true, storage: storageOk,
      summary: { total: 594, byKind: { upload: 6, screenshot: 2, artifact: 586 }, usedBytes: 23_698_514, usedFiles: 594 },
      quota: { unlimited: true, reason: "plan", plan: "Pro", maxBytes: null, maxFiles: null },
    },
    newcomer: {
      files: media.slice(0, 8), more: true, storage: storageOk,
      summary: { total: 512, byKind: { upload: 40, screenshot: 120, artifact: 352 }, usedBytes: 61_440_000, usedFiles: 512 },
      quota: { unlimited: false, reason: null, plan: null, maxBytes: 250 * 1024 * 1024, maxFiles: 500 },
    },
  };
  const vaultOf = () => vaults[state.account] ?? vaults.operator;
  const mediaIds = new Set([...media.map(file => file.id), ...[...tasks.values()].flatMap(task => task.events.filter(event => event.type === "artifacts").flatMap(event => event.files.map(file => file.mediaId)).filter(Boolean))]);
  const legacyDeployments = [...tasks.values()].flatMap(task => task.deployments.map(view => ({
    id: view.id, sessionId: task.row.id, status: view.state === "live" ? "live" : "deleted", url: view.url, repo: view.target.repo, serviceId: `svc-${view.id.slice(0, 8)}`,
    detail: view.detail, expiresAt: view.expiresAt, createdAt: view.createdAt, deletedAt: view.removedAt,
  })));

  // ---- API (method + path; the first match wins, HEAD falls back to GET) ----

  const notFound = () => ({ status: 404, json: { error: "Not found." } });
  const withTask = (id, fn) => (tasks.has(id) ? fn(tasks.get(id)) : notFound());
  const runStarted = (task, n) => ({ status: 202, json: { status: "queued", runId: rid(90 + n), attempt: (task.row.attempt ?? 1) + 1 } });
  const listRows = () => rows.map(({ answer: _answer, ...row }) => row).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const storageDown = (extra = {}) => ({ status: 503, retryAfter: 30, expected: true, json: { error: "File storage is temporarily unavailable. Try again in a moment.", code: "storage_unavailable", retryAfter: 30, ...extra } });
  const fileOf = (task, path) => task.tree.files.includes(path) ? path : null;
  const textFor = path => {
    if (path === DEEP_FILE) return CODE.deep;
    if (path.endsWith("README.md")) return CODE.readme;
    if (path.endsWith("RevenueChart.tsx")) return CODE.chart;
    if (path.endsWith("InvoiceRows.tsx")) return CODE.invoiceRows;
    if (path.endsWith(".json")) return `{\n  "name": "fixture",\n  "private": true,\n  "scripts": { "build": "tsc -b && vite build", "test": "vitest run" }\n}\n`;
    return `// ${path}\nexport {};\n`;
  };
  const binary = path => /\.(png|jpe?g|gif|webp|pdf|woff2?|ico)$/i.test(path);

  /** SSE for one task: sync, the log after `after`, then end (a live run keeps the stream open). */
  const stream = (task, after) => {
    const last = task.events.length ? task.events[task.events.length - 1].seq : 0;
    const maxSeq = task.live && after < task.liveFrom ? task.liveFrom - 1 : last;
    return {
      sync: { maxSeq, status: task.row.status, statusReason: task.row.statusReason ?? null, runId: task.row.runId ?? null, live: task.live },
      events: task.events.filter(event => event.seq > after),
      end: !task.live,
    };
  };

  const routes = [
    ["GET", "/api/health", () => ({ json: { status: "ok" } }), { public: true }],
    ["POST", "/api/auth/login", ({ body }) => (body?.password ? { json: { ok: true } } : { status: 400, expected: true, json: { error: "Enter the password." } }), { public: true }],
    ["POST", "/api/auth/logout", () => ({ json: { ok: true } }), { public: true }],
    ["GET", "/api/auth/github/start", () => ({ contentType: "text/html; charset=utf-8", body: htmlPage("GitHub sign-in (fixture)", "<h1>GitHub sign-in</h1><p>The UI check does not leave the fixture world.</p>") })],

    ["GET", "/api/agent/models", () => ({ json: { models } })],
    // The vault probe follows the signed-in account's storage (down for the operator, working elsewhere).
    ["GET", "/api/agent/health", ({ query }) => {
      const listed = providers.map(probe => (probe.id === "vault" && vaultOf().storage.ok ? { ...probe, ok: true, detail: "File storage is ready." } : probe));
      return { json: { providers: query.get("deep") === "1" ? listed.map(probe => (probe.id === "gemini" ? { ...probe, latencyMs: 1840, detail: "Live completion OK (6 tokens)" } : probe)) : listed, activeTasks: stats.active } };
    }],
    ["GET", "/api/agent/keys", () => ({ json: { keys } })],
    ["GET", "/api/agent/stats", () => ({ json: stats })],

    ["GET", "/api/agent/tasks", () => ({ json: { tasks: listRows() } })],
    ["POST", "/api/agent/tasks", () => ({ status: 201, json: { taskId: TASK.queued } })],
    ["GET", "/api/agent/tasks/:id", ({ params }) => withTask(params.id, task => ({ json: { task: task.row, live: task.live, running: task.live } }))],
    ["DELETE", "/api/agent/tasks/:id", ({ params }) => withTask(params.id, task => (ACTIVE.has(task.row.status)
      ? { status: 409, expected: true, json: { error: "Cancel the run first.", status: task.row.status } }
      : { json: { deleted: true, previewsRemoved: task.deployments.length, filesRemoved: task.tree.files.length, filesKept: 0 } }))],
    ["GET", "/api/agent/tasks/:id/events", ({ params, query }) => withTask(params.id, task => ({ sse: stream(task, Number(query.get("after") ?? 0) || 0) }))],
    ["POST", "/api/agent/tasks/:id/messages", ({ params }) => withTask(params.id, task => (ACTIVE.has(task.row.status)
      ? { status: 409, expected: true, json: { error: "Wait for the current run to finish, or cancel it." } }
      : { status: 202, json: { ok: true, ...runStarted(task, 1).json } }))],
    ["POST", "/api/agent/tasks/:id/cancel", ({ params }) => withTask(params.id, task => (ACTIVE.has(task.row.status)
      ? { status: 202, json: { status: "cancelling", statusReason: "user_cancel", runId: task.row.runId ?? null, changed: true } }
      : { json: { status: task.row.status, statusReason: task.row.statusReason, runId: task.row.runId ?? null, changed: false } }))],
    ["POST", "/api/agent/tasks/:id/retry", ({ params }) => withTask(params.id, task => (RETRYABLE.has(task.row.status)
      ? runStarted(task, 2)
      : { status: 409, expected: true, json: { error: task.row.status === "completed" ? "This task completed; send a follow-up instead." : "The task is running." } }))],
    ["POST", "/api/agent/tasks/:id/deploy", ({ params, body }) => withTask(params.id, task => (body?.confirm !== true
      ? { status: 400, expected: true, json: { error: "Confirm the deploy first." } }
      : ACTIVE.has(task.row.status) ? { status: 409, expected: true, json: { error: "Wait for the run to finish." } } : runStarted(task, 3)))],
    ["GET", "/api/agent/tasks/:id/tree", ({ params }) => withTask(params.id, task => ({ json: { source: task.tree.source, entries: treeEntries(task.tree.files) } }))],
    ["GET", "/api/agent/tasks/:id/file", ({ params, query }) => withTask(params.id, task => {
      const path = fileOf(task, String(query.get("path") ?? ""));
      if (!path) return { status: 404, json: { error: "File not found." } };
      const name = path.split("/").pop();
      if (query.get("download") === "1") return { body: binary(path) ? SCREENSHOT_PNG : textFor(path), contentType: "application/octet-stream", headers: { "content-disposition": `attachment; filename="${name}"` } };
      if (query.get("raw") === "1") return /\.png$/i.test(path) ? { body: SCREENSHOT_PNG, contentType: "image/png" } : { body: textFor(path), contentType: "application/octet-stream", headers: { "content-disposition": `attachment; filename="${name}"` } };
      if (binary(path)) return { json: { path, content: "", bytes: 188_240, binary: true } };
      const content = textFor(path);
      return { json: { path, content, bytes: Buffer.byteLength(content) } };
    })],
    ["POST", "/api/agent/tasks/:id/repo", ({ params, body }) => withTask(params.id, task => (ACTIVE.has(task.row.status)
      ? { status: 409, expected: true, json: { error: "Wait for the task to finish before selecting a repository." } }
      : { json: { repo: body?.repo ?? LONG_REPO, branch: body?.branch ?? "main", baseSha: "9f2c4e1b7a3d5c6e8f0a1b2c3d4e5f6a7b8c9d0e", repoPath: "repo", url: `https://github.com/${body?.repo ?? LONG_REPO}`, files: 412 } }))],
    ["POST", "/api/agent/tasks/:id/export/plan", ({ params }) => withTask(params.id, task => ({ json: task.exportPlan }))],
    ["POST", "/api/agent/tasks/:id/export", ({ params, body = {} }) => withTask(params.id, task => {
      const target = task.exportPlan.target;
      if (ACTIVE.has(task.row.status)) return { status: 409, expected: true, json: { error: "Wait for the task to finish before exporting." } };
      if (target.kind === "linked") {
        if (!body.branch) return { status: 400, expected: true, json: { error: "Choose the branch to push to." } };
        if (body.branch === target.defaultBranch && !body.confirmDefaultBranch) return { status: 400, expected: true, json: { error: `Pushing to ${target.defaultBranch} needs explicit confirmation.`, code: "confirm_default_branch" } };
        return { json: { repo: target.repo, url: target.url, commitUrl: `${target.url}/commit/4c1d2e3f`, files: 3, created: false, branch: body.branch } };
      }
      if (target.kind === "new") {
        if (!body.repoName) return { status: 400, expected: true, json: { error: "Name the new repository." } };
        if (!body.visibility) return { status: 400, expected: true, json: { error: "Choose whether the new repository is private or public.", code: "visibility_required" } };
        if (body.visibility === "public" && !body.confirmPublic) return { status: 400, expected: true, json: { error: "Creating a public repository needs explicit confirmation.", code: "confirm_public" } };
      }
      if (target.kind === "existing" && target.remote !== "ours" && !body.confirmOverwrite) {
        return { status: 409, expected: true, json: { error: `${target.branch} has commits that weren't pushed from this workspace. Pushing replaces their files; confirm to push anyway.`, code: "remote_changed", branch: target.branch } };
      }
      const repoName = target.kind === "new" ? `${LOGIN}/${body.repoName}` : target.repo;
      return { json: { repo: repoName, url: `https://github.com/${repoName}`, commitUrl: `https://github.com/${repoName}/commit/4c1d2e3f`, files: task.exportPlan.files ?? 0, created: target.kind === "new", ...(target.kind === "existing" ? { branch: target.branch ?? "main" } : {}) } };
    })],
    ["GET", "/api/agent/tasks/:id/preview", ({ params }) => withTask(params.id, task => ({ json: task.preview }))],
    ["POST", "/api/agent/tasks/:id/workspace/restore", ({ params }) => withTask(params.id, task => (ACTIVE.has(task.row.status)
      ? { status: 409, expected: true, json: { error: "The task is running; its workspace is already live." } }
      : { json: { restored: task.tree.files.length, preview: task.preview.build ? { dir: task.preview.build.dir } : null } }))],
    ["POST", "/api/agent/tasks/:id/preview/screenshot", ({ params }) => withTask(params.id, task => (task.preview.available
      ? { json: { status: 200, title: "Q4 Launch", consoleErrors: [], image: `data:image/png;base64,${SCREENSHOT_PNG.toString("base64")}` } }
      : { status: 404, expected: true, json: { error: "No built web output to screenshot." } }))],
    ["GET", "/api/agent/tasks/:id/browser/:sessionId", ({ params }) => withTask(params.id, task => {
      const session = task.browsers[params.sessionId];
      return { headers: { "cache-control": "no-store" }, json: session?.status === "live" ? { status: "live", viewer: session.viewer, title: session.title, url: session.url } : { status: "ended", viewer: null, title: "", url: "" } };
    })],
    ["POST", "/api/agent/tasks/:id/browser/:sessionId/reconnect", ({ params }) => withTask(params.id, task => {
      const session = task.browsers[params.sessionId];
      return session?.status === "live" ? { json: { status: "live", viewer: session.viewer, title: session.title, url: session.url } } : { status: 410, expected: true, json: { status: "ended", viewer: null, title: "", url: "" } };
    })],
    ["GET", "/api/agent/tasks/:id/deployments", ({ params }) => withTask(params.id, task => ({ json: { deployments: task.deployments, capabilities: { configured: true, github: true } } }))],
    ["DELETE", "/api/agent/tasks/:id/deployments/:deploymentId", ({ params }) => withTask(params.id, task => (task.deployments.some(view => view.id === params.deploymentId)
      ? { json: { deployments: task.deployments.map(view => (view.id === params.deploymentId ? { ...view, state: "removed", removedAt: iso(now), removedReason: "user", canRemove: false } : view)) } }
      : notFound()))],
    ["GET", "/api/agent/deployments", () => ({ json: { deployments: legacyDeployments, configured: { ok: true } } })],
    ["DELETE", "/api/agent/deployments/:id", () => ({ json: { deleted: true } })],

    // Media: the operator's storage is down (GET/HEAD of a file answer 503 with Retry-After, never 500).
    // The other accounts' storage works: "free" is on Pro (unlimited, 594 files, more pages), "newcomer"
    // has a full free vault (512 of 500 files).
    ["GET", "/api/agent/media", ({ query }) => {
      const vault = vaultOf();
      const kind = query.get("kind") || null;
      const q = (query.get("q") || "").toLowerCase();
      const files = vault.files.filter(file => (!kind || file.kind === kind) && (!q || file.filename.toLowerCase().includes(q)));
      const paged = Boolean(query.get("cursor"));
      const more = vault.more && !q && !paged;
      const matching = q ? files.length : kind ? vault.summary.byKind[kind] : vault.summary.total;
      return { json: { files: paged ? [] : files, nextCursor: more && files.length ? `1762000000000000_${files[files.length - 1].id}` : null, matching, summary: vault.summary, quota: vault.quota, stage: { ok: vault.storage.ok, detail: vault.storage.detail }, storage: vault.storage } };
    }],
    ["GET", "/api/agent/media/ids", ({ query }) => {
      const vault = vaultOf();
      const kind = query.get("kind") || null;
      const ids = vault.files.filter(file => !kind || file.kind === kind).map(file => file.id);
      return { json: { ids, total: ids.length } };
    }],
    ["POST", "/api/agent/media/delete", ({ body }) => {
      const ids = Array.isArray(body?.ids) ? body.ids : [];
      if (state.account === "operator") return storageDown({ error: "File storage isn't available right now, so nothing was deleted.", deleted: [], kept: [], notFound: [], failed: ids.map(id => ({ id, code: "storage_unavailable", error: "File storage is temporarily unavailable." })), skipped: [] });
      return { json: { deleted: ids, kept: [], notFound: [], failed: [], skipped: [] } };
    }],
    // Uploads: the operator's are refused (storage down); elsewhere the third upload of a check is too large.
    ["POST", "/api/agent/media", () => {
      if (state.account === "operator") return storageDown({ error: "File storage is temporarily unavailable. You can still send your message without attachments." });
      state.uploads = (state.uploads ?? 0) + 1;
      if (state.uploads === 3) return { status: 413, expected: true, json: { error: "Files are limited to 25 MB.", code: "too_large" } };
      return { status: 201, json: { file: { id: mid(60 + state.uploads), filename: `upload-${state.uploads}.png`, mimeType: "image/png", sizeBytes: 48_204, kind: "upload" } } };
    }],
    ["GET", "/api/agent/media/health", () => ({ headers: { "cache-control": "no-store" }, json: vaultOf().storage })],
    ["HEAD", "/api/agent/media/:id", ({ params }) => (!mediaIds.has(params.id) ? { status: 404 } : vaultOf().storage.ok ? { status: 200 } : { status: 503, retryAfter: 30, expected: true })],
    ["GET", "/api/agent/media/:id/text", ({ params }) => (mediaIds.has(params.id) ? (vaultOf().storage.ok ? { json: { filename: "notes.md", content: "# Notes", truncated: false, bytes: 7 } } : storageDown()) : { status: 404, json: { error: "Not found.", code: "media_not_found" } })],
    ["GET", "/api/agent/media/:id", ({ params }) => (mediaIds.has(params.id) ? (vaultOf().storage.ok ? { contentType: "image/png", headers: { "cache-control": "private, max-age=31536000, immutable" }, body: VAULT_PNG } : storageDown()) : { status: 404, json: { error: "Not found.", code: "media_not_found" } })],
    ["DELETE", "/api/agent/media/:id", ({ params }) => (!mediaIds.has(params.id) ? { status: 404, json: { error: "Not found.", code: "media_not_found" } } : vaultOf().storage.ok ? { json: { deleted: true, kept: false } } : storageDown({ error: "File storage is temporarily unavailable, so nothing was deleted." }))],

    // The signed-in account's own GitHub connection (the operator's unless a check signs in as another).
    ["GET", "/api/agent/github", () => ({ json: githubOf() })],
    ["DELETE", "/api/agent/github", () => ({ json: { disconnected: true } })],
    ["GET", "/api/agent/github/repos", () => ({ json: repos })],
    ["GET", "/api/github/repos", () => ({ json: repos })],

    // The same-origin workspace preview the Preview tab frames (any method: the panel HEADs it first).
    ["*", "/api/workspace/preview/:taskId/:token/*", ({ params }) => (tasks.get(params.taskId)?.preview.available
      ? { contentType: "text/html; charset=utf-8", body: PREVIEW_SITE_HTML }
      : { status: 404, contentType: "text/plain; charset=utf-8", body: "Preview not found or expired." })],
  ];

  /** tRPC procedures (httpBatchLink + superjson): name -> plain JSON result. */
  // Signed in as the operator (unlimited) unless a check asks for another account: "free"
  // (ada-lovelace, on Pro, with an API balance) or "newcomer" (on the free allowance, nothing bought).
  const operator = { id: "00000000-0000-4000-8000-0000000000aa", role: "admin", login: "mouno19", displayName: "Operator", avatarUrl: null, email: null };
  const free = { id: "00000000-0000-4000-8000-0000000000bb", role: "user", login: "ada-lovelace", displayName: "Ada Lovelace", avatarUrl: null, email: null };
  const newcomer = { id: "00000000-0000-4000-8000-0000000000dd", role: "user", login: "katherine-johnson", displayName: "Katherine Johnson", avatarUrl: null, email: null };
  const account = () => (state.account === "free" ? free : state.account === "newcomer" ? newcomer : operator);
  // People on other orders and in the accounts list (billing-fixtures.mjs names them too).
  const person = (n, login, name) => ({ id: `00000000-0000-4000-8000-0000000000${n}`, login, name });
  const billingUsers = {
    operator: { id: operator.id, login: operator.login, name: operator.displayName }, free: { id: free.id, login: free.login, name: free.displayName },
    newcomer: { id: newcomer.id, login: newcomer.login, name: newcomer.displayName }, grace: person("cc", "grace-hopper-with-a-long-login", "Grace Hopper"),
    hedy: person("e1", "hedy-lamarr", "Hedy Lamarr"), alan: person("e2", "alan-turing-research", "Alan Turing"), margaret: person("e3", "margaret-hamilton", "Margaret Hamilton"), radia: person("e4", "radia-perlman", "Radia Perlman"),
  };
  const billing = createBilling({ now, state, users: billingUsers });
  const githubOf = () => (state.account === "operator" ? github : { ...github, login: account().login, name: account().displayName, avatarUrl: null });
  const resetsSoon = new Date(now + 2 * 3_600_000 + 14 * 60_000).toISOString();
  const balance = (fields, plan = null) => ({ unlimited: false, allowance: 60, used: 0, remaining: 60, bonus: 0, available: 60, resetsAt: null, windowHours: 5, ...fields, plan });
  // On Pro: the plan's allowance is larger than the free one, so it applies (shared/credits.ts CreditBalance.plan).
  const freeCredits = balance({ allowance: 6000, used: 1284.5, remaining: 4715.5, bonus: 25, available: 4740.5, resetsAt: resetsSoon }, billing.planOf(billingUsers.free));
  const newcomerCredits = balance({ used: 41.5, remaining: 18.5, bonus: 25, available: 43.5, resetsAt: resetsSoon });
  const operatorCredits = { unlimited: true, allowance: 60, used: 0, remaining: 60, bonus: 0, available: 60, resetsAt: null, windowHours: 5, plan: null };
  const credits = () => (state.account === "free" ? freeCredits : state.account === "newcomer" ? newcomerCredits : operatorCredits);
  const days = n => new Date(now - n * 86_400_000).toISOString();
  const minutesAgo = n => new Date(now - n * 60_000).toISOString();
  const billingOf = user => ({ plan: billing.planOf(user), apiBalanceUsd: billing.apiBalanceUsd(user) });
  const adminUsers = [
    { id: operator.id, role: "admin", login: "mouno19", name: "Operator", avatarUrl: null, email: null, createdAt: days(4), lastSeenAt: minutesAgo(1), banned: false, tasks: 45, activeRuns: 1, creditsUsedTotal: 0, customAllowance: null, credits: operatorCredits, plan: null, apiBalanceUsd: 0 },
    { id: free.id, role: "user", login: "ada-lovelace", name: "Ada Lovelace", avatarUrl: null, email: "ada@example.com", createdAt: days(41), lastSeenAt: minutesAgo(25), banned: false, tasks: 7, activeRuns: 0, creditsUsedTotal: 9843.6, customAllowance: null, credits: freeCredits, ...billingOf(billingUsers.free) },
    { id: billingUsers.grace.id, role: "user", login: "grace-hopper-with-a-long-login", name: "Grace Hopper", avatarUrl: null, email: null, createdAt: new Date(now - 6 * 3_600_000).toISOString(), lastSeenAt: null, banned: true, tasks: 1, activeRuns: 0, creditsUsedTotal: 3, customAllowance: 120, credits: balance({ allowance: 120, remaining: 117, used: 3, available: 117, resetsAt: resetsSoon }), ...billingOf(billingUsers.grace) },
    { id: newcomer.id, role: "user", login: newcomer.login, name: newcomer.displayName, avatarUrl: null, email: null, createdAt: days(6), lastSeenAt: minutesAgo(3), banned: false, tasks: 3, activeRuns: 0, creditsUsedTotal: 211.5, customAllowance: null, credits: newcomerCredits, ...billingOf(billingUsers.newcomer) },
    { id: billingUsers.hedy.id, role: "user", login: "hedy-lamarr", name: "Hedy Lamarr", avatarUrl: null, email: null, createdAt: days(19), lastSeenAt: minutesAgo(90), banned: false, tasks: 12, activeRuns: 0, creditsUsedTotal: 402, customAllowance: null, credits: balance({ used: 12, remaining: 48, available: 48, resetsAt: resetsSoon }), ...billingOf(billingUsers.hedy) },
    { id: billingUsers.alan.id, role: "user", login: "alan-turing-research", name: "Alan Turing", avatarUrl: null, email: null, createdAt: minutesAgo(40), lastSeenAt: minutesAgo(5), banned: false, tasks: 0, activeRuns: 0, creditsUsedTotal: 0, customAllowance: null, credits: balance({}), ...billingOf(billingUsers.alan) },
    { id: billingUsers.margaret.id, role: "user", login: "margaret-hamilton", name: "Margaret Hamilton", avatarUrl: null, email: "margaret@example.com", createdAt: days(33), lastSeenAt: minutesAgo(600), banned: false, tasks: 61, activeRuns: 1, creditsUsedTotal: 48_120, customAllowance: null, credits: balance({ allowance: 30_000, used: 2_310, remaining: 27_690, available: 27_690, resetsAt: resetsSoon }, billing.planOf(billingUsers.margaret)), ...billingOf(billingUsers.margaret) },
    { id: billingUsers.radia.id, role: "user", login: "radia-perlman", name: "Radia Perlman", avatarUrl: null, email: null, createdAt: days(8), lastSeenAt: days(2), banned: false, tasks: 4, activeRuns: 0, creditsUsedTotal: 96, customAllowance: null, credits: balance({}), ...billingOf(billingUsers.radia) },
  ];
  const promoCodes = [
    { id: "00000000-0000-4000-8000-0000000000d1", code: "LAUNCH-2026", credits: 100, forUser: null, maxRedemptions: 50, redemptions: 12, expiresAt: new Date(now + 20 * 86_400_000).toISOString(), disabledAt: null, note: "Launch post", createdAt: new Date(now - 86_400_000).toISOString(), state: "active" },
    { id: "00000000-0000-4000-8000-0000000000d2", code: "K7PQR-3MXWT", credits: 500, forUser: { id: free.id, login: "ada-lovelace" }, maxRedemptions: 1, redemptions: 1, expiresAt: null, disabledAt: null, note: null, createdAt: new Date(now - 3_600_000).toISOString(), state: "used_up" },
  ];
  routes.push(
    ["GET", "/api/account", () => ({ json: { user: account(), credits: credits(), github: githubOf(), voice: { available: true } } })],
    // Voice: dictation and read aloud answer from fixtures (no audio is recorded or played in a check).
    ["POST", "/api/agent/voice/transcribe", () => ({ json: { text: "Build a landing page with a pricing table", seconds: 3.2, language: "en" } })],
    ["POST", "/api/agent/tasks/:id/speech", () => ({ contentType: "audio/mpeg", body: "" })],
    ["GET", "/api/account/credits", () => ({ json: { credits: credits(), history: [] } })],
    ["GET", "/api/admin/overview", () => ({ json: { users: adminUsers.length, newToday: 1, activeToday: 5, activeRuns: 2, creditsUsedToday: 2318.25, activePromoCodes: 1, settings: { creditsPerWindow: 60, windowHours: 5, signupsOpen: true } } })],
    ["GET", "/api/admin/users", () => ({ json: { users: adminUsers, more: false } })],
    ["GET", "/api/admin/promo-codes", () => ({ json: { codes: promoCodes } })],
    ["GET", "/api/admin/settings", () => ({ json: { settings: { creditsPerWindow: 60, windowHours: 5, signupsOpen: true } } })],
    ["PUT", "/api/admin/settings", () => ({ json: { settings: { creditsPerWindow: 60, windowHours: 5, signupsOpen: true } } })],
    ["POST", "/api/account/redeem", () => ({ status: 400, json: { error: "That code isn't valid.", code: "invalid_code" } })],
    // Support: one open conversation waiting on a reply, and one already closed.
    ["GET", "/api/support/unread", () => ({ json: { unread: 1 } })],
    ["GET", "/api/support/threads", () => ({ json: {
      unread: 1,
      threads: [
        { id: "00000000-0000-4000-8000-0000000000c1", subject: "Preview stayed on building", status: "open", createdAt: minutesAgo(40), updatedAt: minutesAgo(6), preview: "It has said building for twenty minutes.", unread: true, own: false, account: { name: "Ada Lovelace", login: "ada-lovelace" } },
        { id: "00000000-0000-4000-8000-0000000000c2", subject: "Where welcome credits show", status: "closed", createdAt: minutesAgo(4000), updatedAt: minutesAgo(3000), preview: "They are on Plans & Billing, under your balance.", unread: false, own: false, account: { name: "Grace Hopper", login: "grace-hopper-with-a-long-login" } },
      ],
    } })],
    ["GET", "/api/support/threads/:id", () => ({ json: {
      unread: 0,
      thread: {
        id: "00000000-0000-4000-8000-0000000000c1", subject: "Preview stayed on building", status: "open", createdAt: minutesAgo(40), updatedAt: minutesAgo(6), preview: "It has said building for twenty minutes.", unread: false, own: false, account: { name: "Ada Lovelace", login: "ada-lovelace" },
        messages: [
          { id: "00000000-0000-4000-8000-0000000000c3", body: "I published a preview and it still says building.", createdAt: minutesAgo(40), mine: false, fromStaff: false },
          { id: "00000000-0000-4000-8000-0000000000c4", body: "Builds usually finish within a few minutes. If this one stays on building, start a new preview from the Preview tab.", createdAt: minutesAgo(20), mine: true, fromStaff: true },
          { id: "00000000-0000-4000-8000-0000000000c5", body: "It has said building for twenty minutes.", createdAt: minutesAgo(6), mine: false, fromStaff: false },
        ],
      },
    } })],
    ["POST", "/api/support/threads", () => ({ status: 201, json: { unread: 0, thread: { id: "00000000-0000-4000-8000-0000000000c1", subject: "Preview stayed on building", status: "open", createdAt: minutesAgo(1), updatedAt: minutesAgo(1), preview: "It still says building.", unread: false, own: true, account: null, messages: [] } } })],
    ["POST", "/api/support/threads/:id/messages", () => ({ json: { unread: 0, thread: { id: "00000000-0000-4000-8000-0000000000c1", subject: "Preview stayed on building", status: "open", createdAt: minutesAgo(40), updatedAt: minutesAgo(1), preview: "Thanks, that fixed it.", unread: false, own: false, account: { name: "Ada Lovelace", login: "ada-lovelace" }, messages: [] } } })],
    ["POST", "/api/support/threads/:id/close", () => ({ json: { unread: 0, thread: { id: "00000000-0000-4000-8000-0000000000c1", subject: "Preview stayed on building", status: "closed", createdAt: minutesAgo(40), updatedAt: minutesAgo(1), preview: "It has said building for twenty minutes.", unread: false, own: false, account: { name: "Ada Lovelace", login: "ada-lovelace" }, messages: [] } } })],
    ["GET", "/api/admin/users/:id/credits", ({ params }) => ({ json: { credits: adminUsers.find(user => user.id === params.id)?.credits ?? freeCredits, history: [] } })],
    ["POST", "/api/admin/users/:id/credits", () => ({ json: { credits: freeCredits } })],
    ["PUT", "/api/admin/users/:id/allowance", () => ({ json: { credits: freeCredits } })],
    ["PUT", "/api/admin/users/:id/free-allowance", ({ params }) => ({ json: { credits: adminUsers.find(user => user.id === params.id)?.credits ?? freeCredits } })],
    ["POST", "/api/admin/users/:id/ban", () => ({ json: { banned: true } })],
    ["POST", "/api/admin/promo-codes", () => ({ status: 201, json: { code: promoCodes[0] } })],
    ["POST", "/api/admin/promo-codes/:id/disable", () => ({ json: { codes: promoCodes } })],
    // GitHub sign-in leaves the site: the check never follows it.
    ["GET", "/api/auth/github/login", () => ({ status: 302, headers: { location: "/login" } })],
    // Plans & Billing, payments, the Developer API balance, keys and usage (billing-fixtures.mjs).
    ...billing.routes,
  );

  const trpc = {
    "auth.me": () => {
      const user = account();
      return { user: state.signedIn ? { id: user.id, login: user.login, name: user.displayName, avatarUrl: null, role: user.role } : null, admin: state.signedIn && user.role === "admin", configured: true, github: true, signupsOpen: true };
    },
    "auth.logout": () => ({ success: true }),
    "skills.list": () => [],
  };

  const scenarios = [...tasks.values()].filter(task => !task.listOnly).map(task => ({ key: task.key, id: task.row.id, title: task.title, live: task.live }));
  return {
    now, state, tasks, routes, trpc, scenarios,
    liveTaskIds: scenarios.filter(scenario => scenario.live).map(scenario => scenario.id),
    redeployTaskId: TASK.redeploy,
    sandbox: { taskId: TASK.completed, path: DEEP_FILE },
    data: { providers, storage, stats, models, keys, github, repos, media, legacyDeployments, adminUsers, billing: billing.data },
    /** Billing pages: the payment page's states (one order each), the order the admin dialog opens. */
    billing: { payStates: billing.payStates, reviewOrderCode: billing.reviewOrderCode, reports: billing.reports, users: billing.users },
    /** Values that are leak bait on purpose (skipped by the fixture self-scan). */
    baitValues: new Set([SECRET_LIVE_URL, SECRET_REPLAY_URL, ...[...tasks.values()].flatMap(task => task.deployments.map(view => view.url))]),
    reset() {
      state.signedIn = true;
      state.account = "operator";
      state.uploads = 0;
      // Orders' countdowns and deadlines are relative to the check that is starting.
      billing.refresh(Date.now());
    },
  };
}
