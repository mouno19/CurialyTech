import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, TriangleAlert, Wallet } from "lucide-react";
import { COIN_INFO, networkInfo, type AdminWalletBalances } from "@shared/billing";
import { IconButton } from "@/components/common/IconButton";
import { CopyButton } from "@/components/billing/CopyButton";
import { momentText } from "@/components/billing/format";
import { errorMessage } from "@/lib/api";
import { adminBillingApi } from "@/lib/billing";
import { ExplorerLink } from "./parts";

// What the receiving wallets hold right now on every network payments use, read from the chains by
// address (the server keeps a reading for 30 seconds). Confirms on the operator's side that paid
// orders' funds are there, without a key anywhere.

/** "1,234.5" for a decimal string, keeping its precision up to six places. */
function amountText(amount: string) {
  const [whole, fraction = ""] = amount.split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  const kept = fraction.slice(0, 6).replace(/0+$/, "");
  return kept ? `${grouped}.${kept}` : grouped;
}

export function WalletBalances() {
  const [data, setData] = useState<AdminWalletBalances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const next = await adminBillingApi.wallets();
      if (mine !== seq.current) return;
      setData(next);
      setError(null);
    } catch (loadError) {
      if (mine === seq.current) setError(errorMessage(loadError, "Couldn't read the wallets."));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="card admin-card admin-wallet-balances" aria-labelledby="admin-wallet-balances-title">
      <div className="card-head admin-card-head">
        <h3 id="admin-wallet-balances-title"><Wallet size={16} aria-hidden="true" /> Wallet balances</h3>
        <div className="admin-wallet-balances-meta">
          {data && <span className="field-hint">Read from the chains at {momentText(data.checkedAt)}</span>}
          <IconButton size="sm" label="Read the wallets again" icon={RefreshCw} busy={loading} onClick={() => void load()} />
        </div>
      </div>
      {error && (
        <div className="notice" data-tone="danger" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body">{error}</div>
        </div>
      )}
      {!data && !error && <p className="field-hint">Reading the wallets…</p>}
      {data && data.networks.length === 0 && <p className="field-hint">No receiving wallet is set on this server, so no network takes payments.</p>}
      {data && data.networks.length > 0 && (
        <ul className="admin-wallet-list">
          {data.networks.map(network => (
            <li key={network.network} className="admin-wallet-row">
              <div className="admin-wallet-net">
                <strong>{network.label}</strong>
                <span className="admin-wallet-address">
                  <code className="admin-mono" title={network.address}>{network.address.slice(0, 8)}…{network.address.slice(-6)}</code>
                  <CopyButton value={network.address} what={`${network.label} wallet address`} label="Copy" />
                </span>
                <ExplorerLink href={network.explorerUrl} explorer={networkInfo(network.network)?.explorer.name} what={`the wallet on ${network.label}`} />
              </div>
              {network.unavailable ? (
                <p className="admin-wallet-unavailable"><TriangleAlert size={14} aria-hidden="true" /> {network.label} couldn't be reached just now.</p>
              ) : (
                <dl className="admin-wallet-coins">
                  {network.coins.map(coin => (
                    <div key={coin.coin}>
                      <dt><img src={COIN_INFO[coin.coin].logo} alt="" width={16} height={16} /> {coin.coin}</dt>
                      <dd className="tabular">{coin.amount === null ? "Unknown" : amountText(coin.amount)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
