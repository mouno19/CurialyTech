import { useCallback, useEffect, useRef, useState } from "react";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { RefreshCw, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { formatUsd, networkInfo, type AdminPaymentOrder, type PaymentStatus } from "@shared/billing";
import { momentText } from "@/components/billing/format";
import { PaymentStatusChip } from "@/components/billing/PaymentStatusChip";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { StateNotice } from "@/components/common/StateNotice";
import { useOverflowEdges } from "@/components/common/useOverflowEdges";
import { errorMessage } from "@/lib/api";
import { adminBillingApi } from "@/lib/billing";
import { accountName, appendOrders, filterTotal, isOrderFilter, listSummary, nextOffset, replaceOrder, statusFilters, type OrderFilter } from "./payments";

export type OrderChange = { order: AdminPaymentOrder; at: number };

/**
 * Every order, newest first: filtered by status (Needs attention is the review queue), searched by
 * code, login or transaction hash, 50 at a time. A row opens the order dialog (the page owns it,
 * so /admin?tab=payments&order=… can open it too).
 */
export function PaymentsPanel({ counts, filter, onFilter, onOpen, orderChange, announce, onRefresh }: {
  /** The overview's counts per status (null until it loads). */
  counts: Record<PaymentStatus, number> | null;
  filter: OrderFilter;
  onFilter: (filter: OrderFilter) => void;
  onOpen: (code: string) => void;
  /** The last order changed in the dialog: its row shows the change at once. */
  orderChange: OrderChange | null;
  announce: (message: string) => void;
  /** Reloads the overview (the counts). */
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<AdminPaymentOrder[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  useOverflowEdges(filtersRef);
  // The newest load wins: a slow answer for an older filter or search is dropped.
  const sequence = useRef(0);
  const q = query.trim();

  const load = useCallback(async (status: OrderFilter, text: string, say: boolean) => {
    const mine = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await adminBillingApi.orders({ status, q: text });
      if (mine !== sequence.current) return;
      setOrders(result.orders);
      setMore(result.more);
      if (say) announce(listSummary(status, result.orders.length, result.more, null, text));
    } catch (loadError) {
      if (mine === sequence.current) setError(errorMessage(loadError, "Couldn't load payments."));
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, [announce]);

  // The first load is quiet; a new filter or search says what it found.
  const first = useRef(true);
  useEffect(() => {
    const say = !first.current;
    const timer = setTimeout(() => {
      first.current = false;
      void load(filter, q, say);
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, filter, q]);

  useEffect(() => {
    if (orderChange) setOrders(current => (current ? replaceOrder(current, orderChange.order) : current));
  }, [orderChange]);

  const refresh = () => {
    void load(filter, q, true);
    onRefresh();
  };
  const loadMore = async () => {
    if (!orders || loadingMore) return;
    const mine = sequence.current;
    setLoadingMore(true);
    try {
      // From the rows still in the filter: one approved out of it here no longer counts on the server.
      const result = await adminBillingApi.orders({ status: filter, q, offset: nextOffset(orders, filter) });
      if (mine !== sequence.current) return;
      setOrders(current => appendOrders(current ?? [], result.orders));
      setMore(result.more);
      announce(`${result.orders.length} more ${result.orders.length === 1 ? "order" : "orders"} shown.`);
    } catch (moreError) {
      if (mine === sequence.current) toast.error(errorMessage(moreError, "Couldn't load more payments."));
    } finally {
      setLoadingMore(false);
    }
  };

  const chips = statusFilters(counts);
  const summary = orders === null ? "" : loading ? "Loading…" : listSummary(filter, orders.length, more, q ? null : filterTotal(filter, counts), q);

  return (
    <div className="card admin-card">
      <div className="card-head admin-card-head">
        <h3>Payments</h3>
        <label className="admin-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search payments</span>
          <input className="input" type="search" placeholder="Order code, GitHub login or transaction hash" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <div className="pg-filter-scroll admin-pay-filters" ref={filtersRef}>
        <ToggleGroup.Root type="single" className="segmented pg-filters" aria-label="Filter by status" value={filter} onValueChange={value => { if (value && isOrderFilter(value)) onFilter(value); }}>
          {chips.map(chip => (
            <ToggleGroup.Item key={chip.id} value={chip.id} aria-label={chip.count === null ? chip.label : `${chip.label}, ${chip.count}`} data-attention={(chip.id === "attention" && (chip.count ?? 0) > 0) || undefined}>
              {chip.label}
              <span className="pg-count" aria-hidden="true">{chip.count ?? "–"}</span>
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>
      <div className="pg-statusline admin-pay-status">
        <p>{summary}</p>
        <IconButton size="sm" label="Refresh payments" icon={RefreshCw} busy={loading && orders !== null} onClick={refresh} />
      </div>
      {orders !== null && error && (
        <div className="notice" data-tone="danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body">Couldn't refresh the list: {error}</div>
          <div className="notice-actions"><Button size="sm" icon={RotateCcw} onClick={refresh}>Try again</Button></div>
        </div>
      )}
      {orders === null ? (
        error ? (
          <StateNotice variant="error" size="sm" title="Couldn't load payments" actions={<Button size="sm" icon={RotateCcw} onClick={refresh}>Try again</Button>}>{error}</StateNotice>
        ) : (
          <StateNotice variant="loading" size="sm" title="Loading payments…" />
        )
      ) : orders.length === 0 ? (
        <EmptyOrders filter={filter} query={q} onAll={() => onFilter("all")} />
      ) : (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Payments">
            <table className="data-table admin-table admin-pay-table" aria-busy={loading || undefined}>
              <thead>
                <tr>
                  <th scope="col">Order</th><th scope="col">Account</th><th scope="col">Item</th><th scope="col" className="admin-col-num">Price</th>
                  <th scope="col">Network · coin</th><th scope="col">Status</th><th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => <OrderRow key={order.code} order={order} onOpen={onOpen} />)}
              </tbody>
            </table>
          </div>
          {more && (
            <div className="admin-more-row">
              <Button size="sm" busy={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One order: the code is a button stretched over the row (no clickable <tr>), so the whole row opens it. */
function OrderRow({ order, onOpen }: { order: AdminPaymentOrder; onOpen: (code: string) => void }) {
  const network = networkInfo(order.network);
  const discounted = order.discountPercent > 0 && order.listUsd > order.priceUsd;
  const why = (order.status === "review" || order.status === "rejected") && order.statusDetail;
  return (
    <tr className="admin-pay-row">
      <td>
        <button type="button" className="admin-order-link" onClick={() => onOpen(order.code)}>
          <span className="sr-only">Open order </span>{order.code}
        </button>
      </td>
      <td><span className="admin-pay-account">{accountName(order.user)}</span></td>
      <td className="admin-pay-item">{order.title}</td>
      <td className="num admin-col-num">
        {formatUsd(order.priceUsd)}
        {discounted && <><span className="admin-sub">list {formatUsd(order.listUsd)}</span><span className="admin-sub">{order.discountPercent}% off</span></>}
      </td>
      <td>
        {network && order.coin ? (
          <>
            {order.coin} · {network.label}
            {order.expectedAmount && <span className="admin-sub admin-pay-amount">{order.expectedAmount} {order.coin}</span>}
          </>
        ) : <span className="admin-faint">Not chosen yet</span>}
      </td>
      <td>
        <PaymentStatusChip status={order.status} size="sm" />
        {why && <span className="admin-sub admin-pay-why clamp-2">{why}</span>}
      </td>
      <td className="num"><time dateTime={order.createdAt}>{momentText(order.createdAt)}</time></td>
    </tr>
  );
}

function EmptyOrders({ filter, query, onAll }: { filter: OrderFilter; query: string; onAll: () => void }) {
  const all = filter !== "all" ? <Button size="sm" onClick={onAll}>Show all orders</Button> : undefined;
  if (query) {
    return (
      <StateNotice variant="empty" size="sm" title={`No order matches “${query}”`} actions={all}>
        Search by the order code (CUR-…), the account's GitHub login or the transaction hash.{filter !== "all" ? " The search only covers the status chosen above." : ""}
      </StateNotice>
    );
  }
  if (filter === "attention" || filter === "review") {
    return (
      <StateNotice variant="empty" size="sm" title="Nothing needs your attention">
        Payments the on-chain check can't match, and verified ones waiting for your approval, wait here with the reason.
      </StateNotice>
    );
  }
  if (filter === "all") {
    return <StateNotice variant="empty" size="sm" title="No payments yet">Orders appear here as soon as someone starts one on the Plans & Billing page.</StateNotice>;
  }
  return <StateNotice variant="empty" size="sm" title={listSummary(filter, 0, false, 0, "")} actions={all}>No order has this status right now.</StateNotice>;
}
