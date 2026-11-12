// Tests only (never imported by the server): an in-memory stand-in for the billing tables that
// answers the statements server/billing sends, matched by their text the way the other server tests
// mock ./db/pg. Unknown statements are recorded and fail, so a test can't pass on a query it ignored.

type Row = Record<string, any>;
export type FakeUser = {
  id: string; role: "admin" | "user"; login: string | null; display_name: string;
  plan_id: string | null; plan_expires_at: Date | null; plan_credits_per_window: number | null; api_balance_micros: string;
};

export const fake = {
  users: new Map<string, FakeUser>(),
  orders: [] as Row[],
  events: [] as Row[],
  creditEvents: [] as Row[],
  ledger: [] as Row[],
  settings: new Map<string, unknown>(),
  /** Advisory locks taken (their keys), and every statement run (whitespace collapsed). */
  locks: [] as string[],
  statements: [] as string[],
  unexpected: [] as string[],
  /** Statements that fail as if the database were unreachable. */
  failing: null as null | ((text: string) => boolean),
  ids: 0,
};

export function resetFake() {
  fake.users.clear();
  fake.orders.length = 0;
  fake.events.length = 0;
  fake.creditEvents.length = 0;
  fake.ledger.length = 0;
  fake.settings.clear();
  fake.locks.length = 0;
  fake.statements.length = 0;
  fake.unexpected.length = 0;
  fake.failing = null;
}

const uuid = () => `00000000-0000-4000-8000-${String(++fake.ids).padStart(12, "0")}`;

export function addUser(patch: Partial<FakeUser> & { id: string }): FakeUser {
  const user: FakeUser = { role: "user", login: patch.id, display_name: patch.id, plan_id: null, plan_expires_at: null, plan_credits_per_window: null, api_balance_micros: "0", ...patch };
  fake.users.set(user.id, user);
  return user;
}

/** An order row as the database would hold it (tests start from any state). */
export function addOrder(patch: Row & { user_id: string }): Row {
  const now = new Date();
  const row: Row = {
    id: uuid(), code: `CUR-${String(fake.ids).padStart(8, "0")}`, kind: "plan", plan_id: "pro", plan_days: null, plan_credits_per_window: null, plan_months: null, list_usd: "20.00", discount_percent: 90, price_usd: "2.00", credit_usd: null,
    network: null, coin: null, pay_address: null, expected_amount: null, expected_units: null, quote_usd_price: null, quoted_at: null, tx_hash: null,
    status: "awaiting_payment", status_detail: null, confirmations: null, required_confirmations: null, tx_from: null, tx_block_time: null, received_units: null,
    chain_verified_at: null, check_count: 0, next_check_at: null, last_checked_at: null, admin_note: null, expires_at: new Date(now.getTime() + 30 * 60_000),
    submitted_at: null, completed_at: null, applied_at: null, applied_detail: null, created_at: now, updated_at: now, ...patch,
  };
  fake.orders.push(row);
  return row;
}

export const orderByCode = (code: string) => fake.orders.find(row => row.code === code)!;

const joined = (row: Row): Row => ({ ...row, user_login: fake.users.get(row.user_id)?.login ?? null, user_name: fake.users.get(row.user_id)?.display_name ?? "" });
const newest = (rows: Row[]) => [...rows].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
const OPEN = ["awaiting_payment", "pending", "confirming", "review"];
const PAID = ["confirming", "completed"];
/** An order its transaction matched: confirming, completed, or verified and waiting for the operator. */
const holds = (status: string, verified: unknown) => PAID.includes(status) || (status === "review" && Boolean(verified));
/** payment_orders_paid_tx_idx: one matched order per transaction. */
function paidIndex(row: Row, status: string, verified: unknown = row.chain_verified_at) {
  if (!row.tx_hash || !holds(status, verified)) return;
  if (fake.orders.some(other => other.id !== row.id && other.network === row.network && other.tx_hash === row.tx_hash && holds(other.status, other.chain_verified_at))) {
    throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  }
}
const userColumns = (user: FakeUser) => ({ id: user.id, plan_id: user.plan_id, plan_expires_at: user.plan_expires_at, plan_credits_per_window: user.plan_credits_per_window, api_balance_micros: user.api_balance_micros });
const result = (rows: Row[], rowCount = rows.length) => ({ rows, rowCount });

function event(values: any[]) {
  const [order_id, from_status, to_status, actor, actor_id, note] = values;
  fake.events.push({ id: fake.events.length + 1, order_id, from_status, to_status, actor, actor_id, note, created_at: new Date() });
}

export async function run(sql: string, values: any[] = []): Promise<{ rows: Row[]; rowCount: number }> {
  const text = sql.replace(/\s+/g, " ").trim();
  fake.statements.push(text);
  if (fake.failing?.(text)) throw new Error("Connection terminated unexpectedly");
  const now = new Date();
  const byId = (id: string) => fake.orders.find(row => row.id === id);
  if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return result([]);

  // Settings
  if (text.startsWith("SELECT value FROM curialy.app_settings WHERE key = ")) {
    const key = /key = '(\w+)'/.exec(text)![1];
    return result(fake.settings.has(key) ? [{ value: fake.settings.get(key) }] : []);
  }
  if (text.startsWith("INSERT INTO curialy.app_settings")) {
    fake.settings.set(/VALUES \('(\w+)'/.exec(text)![1], JSON.parse(values[0]));
    return result([]);
  }

  if (text.startsWith("SELECT pg_advisory_xact_lock(hashtext('curialy-pay:'")) {
    fake.locks.push(`curialy-pay:${values[0]}:${values[1]}`);
    return result([{}]);
  }
  if (text.startsWith("SELECT pg_advisory_xact_lock(hashtext($1))")) {
    fake.locks.push(values[0]);
    return result([{}]);
  }

  // Reading orders
  if (text.startsWith("SELECT o.*, u.login AS user_login")) {
    if (text.includes("WHERE o.code = $1")) return result(fake.orders.filter(row => row.code === values[0] && (!text.includes("o.user_id = $2") || row.user_id === values[1])).map(joined));
    if (text.includes("WHERE o.id = $1")) return result(fake.orders.filter(row => row.id === values[0]).map(joined));
    if (text.includes("WHERE o.user_id = $1")) return result(newest(fake.orders.filter(row => row.user_id === values[0])).slice(0, 50).map(joined));
    if (text.includes("WHERE ($1 = 'all'")) {
      const [status, q, , offset] = values;
      const match = (value: unknown) => typeof value === "string" && value.toLowerCase().includes(String(q).toLowerCase());
      const rows = newest(fake.orders).map(joined).filter(row => (status === "all" || (status === "attention" && row.status === "review") || row.status === status) && (q === "" || match(row.code) || match(row.user_login) || match(row.tx_hash)));
      return result(rows.slice(offset, offset + 51));
    }
  }
  if (text.startsWith("SELECT to_status, actor, note, created_at FROM curialy.payment_events")) {
    return result(fake.events.filter(entry => entry.order_id === values[0]).sort((a, b) => a.id - b.id));
  }
  if (text.startsWith("SELECT * FROM curialy.payment_orders WHERE id = $1 FOR UPDATE")) return result(byId(values[0]) ? [{ ...byId(values[0]) }] : []);

  // Placing an order
  if (text.startsWith("SELECT id FROM curialy.payment_orders WHERE user_id = $1 AND status = 'awaiting_payment' AND network IS NULL")) {
    const [userId, kind, planId, list, price, days, credits, months, credit] = values;
    const same = newest(fake.orders).find(row => row.user_id === userId && row.status === "awaiting_payment" && row.network === null && row.kind === kind && (row.plan_id ?? null) === (planId ?? null)
      && Number(row.list_usd) === Number(list) && Number(row.price_usd) === Number(price) && (row.plan_days ?? null) === (days ?? null) && (row.plan_credits_per_window ?? null) === (credits ?? null) && (row.plan_months ?? null) === (months ?? null)
      && (row.credit_usd === null ? null : Number(row.credit_usd)) === (credit === null ? null : Number(credit))
      && row.created_at.getTime() > now.getTime() - 30 * 60_000 && row.expires_at > now);
    return result(same ? [{ id: same.id }] : []);
  }
  if (text.startsWith("SELECT count(*)::int AS n FROM curialy.payment_orders WHERE user_id = $1 AND (status IN ('pending', 'confirming', 'review')")) {
    return result([{ n: fake.orders.filter(row => row.user_id === values[0] && (["pending", "confirming", "review"].includes(row.status) || (row.status === "awaiting_payment" && row.expires_at > now))).length }]);
  }
  if (text.startsWith("INSERT INTO curialy.payment_orders")) {
    const [code, user_id, kind, plan_id, list_usd, discount_percent, price_usd, credit_usd, minutes, plan_days, plan_credits_per_window, plan_months] = values;
    if (fake.orders.some(row => row.code === code)) return result([], 0);
    const row = addOrder({ code, user_id, kind, plan_id, plan_days, plan_credits_per_window, plan_months, list_usd, discount_percent, price_usd, credit_usd, expires_at: new Date(now.getTime() + minutes * 60_000), created_at: now, updated_at: now });
    return result([{ id: row.id }]);
  }
  if (text.startsWith("INSERT INTO curialy.payment_events")) {
    event(values);
    return result([]);
  }

  // Payment details
  if (text.startsWith("SELECT expected_units::text AS units FROM curialy.payment_orders")) {
    const [network, coin] = values;
    const recent = (row: Row) => row.quoted_at && row.quoted_at.getTime() > now.getTime() - 48 * 3_600_000;
    return result(fake.orders.filter(row => row.network === network && row.coin === coin && row.expected_units !== null && (recent(row) || OPEN.includes(row.status))).map(row => ({ units: String(row.expected_units) })));
  }
  if (text.startsWith("UPDATE curialy.payment_orders SET network = $2")) {
    const [id, network, coin, pay_address, expected_amount, expected_units, quote_usd_price, minutes] = values;
    Object.assign(byId(id)!, { network, coin, pay_address, expected_amount, expected_units, quote_usd_price, quoted_at: now, expires_at: new Date(now.getTime() + minutes * 60_000), updated_at: now });
    return result([], 1);
  }

  // Paying ahead: an account's open plan orders.
  if (text.startsWith("SELECT plan_id, plan_days, list_usd FROM curialy.payment_orders WHERE user_id = $1 AND kind = 'plan'")) {
    const open = fake.orders.filter(row => row.user_id === values[0] && row.kind === "plan" && row.plan_id && (["pending", "confirming", "review"].includes(row.status) || (row.status === "awaiting_payment" && row.expires_at > now)));
    return result([...open].sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).map(row => ({ plan_id: row.plan_id, plan_days: row.plan_days, list_usd: row.list_usd })));
  }

  // Hashes and checks
  if (text.startsWith("SELECT code FROM curialy.payment_orders WHERE network = $1 AND tx_hash = $2 AND id <> $3 AND (status IN ('confirming', 'completed') OR")) {
    return result(fake.orders.filter(row => row.network === values[0] && row.tx_hash === values[1] && row.id !== values[2] && holds(row.status, row.chain_verified_at)).slice(0, 1).map(row => ({ code: row.code })));
  }
  if (text.startsWith("SELECT code FROM curialy.payment_orders WHERE network = $1 AND coin = $2 AND expected_units = $3 AND id <> $4")) {
    const [network, coin, units, id, blockTime] = values;
    const recent = (row: Row) => row.quoted_at && row.quoted_at.getTime() > now.getTime() - 48 * 3_600_000;
    return result(fake.orders.filter(row => row.network === network && row.coin === coin && String(row.expected_units) === String(units) && row.id !== id && row.status !== "completed"
      && (recent(row) || OPEN.includes(row.status)) && (!blockTime || (row.quoted_at && row.quoted_at.getTime() <= new Date(blockTime).getTime() + 5 * 60_000))).slice(0, 1).map(row => ({ code: row.code })));
  }
  if (text.startsWith("UPDATE curialy.payment_orders SET tx_hash = $2, status = 'pending'")) {
    const row = byId(values[0])!;
    Object.assign(row, {
      tx_hash: values[1], status: "pending", status_detail: values[2], submitted_at: row.submitted_at ?? now, check_count: 0, next_check_at: now,
      confirmations: null, required_confirmations: null, tx_from: null, tx_block_time: null, received_units: null, chain_verified_at: null, updated_at: now,
    });
    return result([], 1);
  }
  if (text.startsWith("UPDATE curialy.payment_orders SET check_count = check_count + 1")) {
    const [id, force] = values;
    const row = byId(id);
    const due = row && row.tx_hash !== null && row.network !== null && row.expected_units !== null
      && (force ? row.status !== "completed" : ["pending", "confirming"].includes(row.status) && row.next_check_at !== null && row.next_check_at <= now);
    if (!row || !due) return result([], 0);
    Object.assign(row, { check_count: row.check_count + 1, last_checked_at: now, next_check_at: new Date(now.getTime() + 60_000), updated_at: now });
    return result([{ ...row }]);
  }
  if (text.startsWith("SELECT max(created_at) FILTER")) {
    const mine = fake.events.filter(entry => entry.order_id === values[0]);
    const latest = (rows: Row[]) => (rows.length ? new Date(Math.max(...rows.map(entry => entry.created_at.getTime()))) : null);
    return result([{
      submitted: latest(mine.filter(entry => entry.actor === "customer" && entry.to_status === "pending")),
      confirming: latest(mine.filter(entry => entry.to_status === "confirming" && entry.from_status !== "confirming")),
    }]);
  }
  if (text.startsWith("UPDATE curialy.payment_orders SET status = $2, status_detail = $3")) {
    const [id, status, status_detail, confirmations, required_confirmations, tx_from, tx_block_time, received_units, chain_verified_at, seconds] = values;
    paidIndex(byId(id)!, status, chain_verified_at);
    Object.assign(byId(id)!, {
      status, status_detail, confirmations, required_confirmations, tx_from, tx_block_time, received_units, chain_verified_at,
      next_check_at: seconds === null ? null : new Date(now.getTime() + seconds * 1000), updated_at: now,
    });
    return result([], 1);
  }
  if (text.startsWith("SELECT network, coin, min(quoted_at) AS oldest FROM curialy.payment_orders")) {
    const cutoff = now.getTime() - values[0] * 3_600_000;
    const waiting = fake.orders.filter(row => row.tx_hash === null && row.expected_units !== null && row.quoted_at && row.network
      && ["awaiting_payment", "expired"].includes(row.status) && row.expires_at.getTime() > cutoff);
    const groups = new Map<string, Row>();
    for (const row of waiting) {
      const key = `${row.network}:${row.coin}`;
      const current = groups.get(key);
      if (!current || row.quoted_at < current.oldest) groups.set(key, { network: row.network, coin: row.coin, oldest: row.quoted_at });
    }
    return result([...groups.values()]);
  }
  if (text.startsWith("SELECT id, coin, expected_units::text AS units, quoted_at, expires_at FROM curialy.payment_orders")) {
    const [network, hours] = values;
    const cutoff = now.getTime() - hours * 3_600_000;
    return result(fake.orders.filter(row => row.network === network && row.tx_hash === null && row.expected_units !== null && row.quoted_at
      && ["awaiting_payment", "expired"].includes(row.status) && row.expires_at.getTime() > cutoff)
      .map(row => ({ id: row.id, coin: row.coin, units: String(row.expected_units), quoted_at: row.quoted_at, expires_at: row.expires_at })));
  }
  if (text.startsWith("SELECT id FROM curialy.payment_orders WHERE network = $1 AND tx_hash = $2 LIMIT 1")) {
    return result(fake.orders.filter(row => row.network === values[0] && row.tx_hash === values[1]).slice(0, 1).map(row => ({ id: row.id })));
  }
  if (text.startsWith("SELECT id FROM curialy.payment_orders WHERE status IN ('pending', 'confirming') AND next_check_at <= now()")) {
    const due = fake.orders.filter(row => ["pending", "confirming"].includes(row.status) && row.next_check_at && row.next_check_at <= now).sort((a, b) => a.next_check_at - b.next_check_at);
    return result(due.slice(0, values[0]).map(row => ({ id: row.id })));
  }

  // Applying
  if (text.startsWith("SELECT id, plan_id, plan_expires_at, plan_credits_per_window, api_balance_micros FROM curialy.users WHERE id = $1")) {
    const user = fake.users.get(values[0]);
    return result(user ? [userColumns(user)] : []);
  }
  if (text.startsWith("UPDATE curialy.users SET plan_id = $2, plan_expires_at = $3, plan_credits_per_window = $4")) {
    Object.assign(fake.users.get(values[0])!, { plan_id: values[1], plan_expires_at: new Date(values[2]), plan_credits_per_window: values[3] });
    return result([], 1);
  }
  if (text.startsWith("UPDATE curialy.users SET plan_id = NULL")) {
    Object.assign(fake.users.get(values[0])!, { plan_id: null, plan_expires_at: null, plan_credits_per_window: null });
    return result([], 1);
  }
  if (text.startsWith("INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'plan', 0, $2, $3)")) {
    fake.creditEvents.push({ user_id: values[0], kind: "plan", amount: 0, detail: values[1], created_by: values[2] });
    return result([]);
  }
  if (text.startsWith("UPDATE curialy.users SET api_balance_micros = api_balance_micros + $2")) {
    const user = fake.users.get(values[0])!;
    user.api_balance_micros = String(BigInt(user.api_balance_micros) + BigInt(values[1]));
    return result([{ balance: user.api_balance_micros }]);
  }
  if (text.startsWith("UPDATE curialy.users SET api_balance_micros = $2 WHERE id = $1")) {
    fake.users.get(values[0])!.api_balance_micros = String(values[1]);
    return result([], 1);
  }
  if (text.startsWith("INSERT INTO curialy.api_ledger")) {
    const topup = text.includes("VALUES ($1, 'topup'");
    const [user_id, ...rest] = values;
    const [kind, amount_micros, balance_after_micros, order_id, note, created_by] = topup ? ["topup", ...rest] : [rest[0], rest[1], rest[2], null, rest[3], rest[4]];
    fake.ledger.push({ id: fake.ledger.length + 1, user_id, kind, amount_micros: String(amount_micros), balance_after_micros: String(balance_after_micros), order_id, note, created_by, created_at: now });
    return result([]);
  }
  if (text.startsWith("UPDATE curialy.payment_orders SET status = 'completed'")) {
    const row = byId(values[0])!;
    paidIndex(row, "completed");
    Object.assign(row, { status: "completed", status_detail: null, completed_at: now, applied_at: now, applied_detail: JSON.parse(values[1]), admin_note: values[2] ?? row.admin_note, next_check_at: null, updated_at: now });
    return result([], 1);
  }
  if (text.startsWith("UPDATE curialy.payment_orders SET status = 'rejected'")) {
    Object.assign(byId(values[0])!, {
      status: "rejected", status_detail: values[1], admin_note: values[2] ?? values[1], next_check_at: null, updated_at: now,
      ...(text.includes("applied_at = NULL") ? { applied_at: null, applied_detail: null, completed_at: null } : {}),
    });
    return result([], 1);
  }
  if (text.startsWith("WITH expired AS (")) {
    const expired = fake.orders.filter(row => row.status === "awaiting_payment" && row.expires_at <= now);
    for (const row of expired) {
      Object.assign(row, { status: "expired", next_check_at: null, updated_at: now });
      event([row.id, "awaiting_payment", "expired", "system", null, "Expired without a payment"]);
    }
    return result([], expired.length);
  }

  // The operator
  if (text.startsWith("SELECT (SELECT json_object_agg(status, n)")) {
    const counts: Record<string, number> = {};
    for (const row of fake.orders) counts[row.status] = (counts[row.status] ?? 0) + 1;
    const completed = fake.orders.filter(row => row.status === "completed");
    const since = (days: number) => completed.filter(row => row.completed_at && row.completed_at.getTime() > now.getTime() - days * 86_400_000);
    const sum = (rows: Row[]) => (rows.reduce((total, row) => total + Math.round(Number(row.price_usd) * 100), 0) / 100).toFixed(2);
    const plans: Record<string, number> = {};
    for (const user of fake.users.values()) if (user.plan_id && user.plan_expires_at && user.plan_expires_at > now) plans[user.plan_id] = (plans[user.plan_id] ?? 0) + 1;
    const micros = [...fake.users.values()].reduce((total, user) => total + BigInt(user.api_balance_micros), 0n);
    return result([{ counts: Object.keys(counts).length ? counts : null, d7: sum(since(7)), d30: sum(since(30)), total: sum(completed), plans: Object.keys(plans).length ? plans : null, api_micros: String(micros) }]);
  }
  if (text.startsWith("SELECT l.kind, l.amount_micros")) {
    const rows = fake.ledger.filter(entry => entry.user_id === values[0]).sort((a, b) => b.id - a.id).slice(0, 50);
    return result(rows.map(entry => ({ ...entry, order_code: entry.order_id ? byId(entry.order_id)?.code ?? null : null })));
  }

  fake.unexpected.push(text.slice(0, 160));
  throw new Error(`unexpected query: ${text.slice(0, 160)}`);
}

/** The ./db/pg module, backed by the fake. */
export const pgModule = () => ({
  query: run,
  db: () => ({ connect: async () => ({ query: run, release: () => undefined }) }),
  adminUserId: async () => "admin",
});
