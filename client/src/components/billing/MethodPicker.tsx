import { useId, useState } from "react";
import { Link } from "wouter";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { Check, Info, RotateCcw } from "lucide-react";
import { formatUsd, ORDER_TTL_MINUTES, type BillingCatalog, type CoinId, type NetworkId, type PaymentOrder, type PublicCoin } from "@shared/billing";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";

// Stablecoins first: their amount is the dollar price; a network's own coin is priced live.
const byKind = (a: PublicCoin, b: PublicCoin) => (a.kind === b.kind ? 0 : a.kind === "stablecoin" ? -1 : 1);

/**
 * Step 1 network, step 2 coin, step 3 "Get payment details". Only the networks the catalog offers
 * (the ones with a receiving wallet); nothing is fixed on the order until step 3.
 */
export function MethodPicker({ order, catalog, catalogError, onRetryCatalog, busy, blocked, onChoose }: {
  order: PaymentOrder;
  catalog: BillingCatalog | null;
  catalogError: string | null;
  onRetryCatalog: () => void;
  busy: boolean;
  /** Another request is running or the order on screen is out of date. */
  blocked: boolean;
  onChoose: (network: NetworkId, coin: CoinId) => void;
}) {
  const ids = { network: useId(), coin: useId() };
  const [networkId, setNetworkId] = useState<NetworkId | null>(null);
  const [coinId, setCoinId] = useState<CoinId | null>(null);

  if (!catalog) {
    return catalogError ? (
      <StateNotice variant="error" size="sm" title="Couldn't load the payment networks" actions={<Button size="sm" icon={RotateCcw} onClick={onRetryCatalog}>Try again</Button>}>{catalogError}</StateNotice>
    ) : (
      <StateNotice variant="loading" size="sm" title="Loading the payment networks…" />
    );
  }
  if (!catalog.networks.length) {
    return (
      <StateNotice variant="unavailable" size="sm" title="No payment network is open right now" actions={<Link href="/billing" className="btn sm">Back to Plans & Billing</Link>}>
        Payments can't be received at the moment, so there is nothing to send yet. This order stays open until it expires; start a new one later.
      </StateNotice>
    );
  }

  const network = catalog.networks.find(item => item.id === networkId) ?? null;
  const coins = network ? [...network.coins].sort(byKind) : [];
  const coin = coins.find(item => item.coin === coinId) ?? null;
  const pickNetwork = (value: string) => {
    const next = catalog.networks.find(item => item.id === value);
    if (!next) return;
    setNetworkId(next.id);
    // USDT and USDC are on every network; a network's own coin is not.
    if (coinId && !next.coins.some(item => item.coin === coinId)) setCoinId(null);
  };

  return (
    <div className="pay-method-picker">
      {!catalog.paymentsOpen && (
        <div className="notice" data-tone="neutral">
          <Info size={16} aria-hidden="true" />
          <div className="notice-body">New payments are paused right now. If getting the details doesn't work, try again later.</div>
        </div>
      )}
      <fieldset className="pay-step" disabled={blocked}>
        <legend id={ids.network} className="pay-step-title"><span className="pay-step-index" aria-hidden="true">1</span>Network</legend>
        <RadioGroup.Root className="pay-options" value={networkId ?? ""} onValueChange={pickNetwork} aria-labelledby={ids.network}>
          {catalog.networks.map(item => (
            <RadioGroup.Item key={item.id} value={item.id} className="pay-option">
              <img className="pay-option-logo" src={item.logo} alt="" width={28} height={28} />
              <span className="pay-option-body">
                <span className="pay-option-title">{item.label}</span>
                <span className="pay-option-hint">{item.coins.map(entry => entry.coin).join(" · ")}</span>
              </span>
              <RadioGroup.Indicator className="pay-option-check"><Check size={16} aria-hidden="true" /></RadioGroup.Indicator>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </fieldset>

      {network && (
        <fieldset className="pay-step" disabled={blocked}>
          <legend id={ids.coin} className="pay-step-title"><span className="pay-step-index" aria-hidden="true">2</span>Coin on {network.label}</legend>
          <RadioGroup.Root className="pay-options" value={coin?.coin ?? ""} onValueChange={value => setCoinId(value as CoinId)} aria-labelledby={ids.coin}>
            {coins.map(item => (
              <RadioGroup.Item key={item.coin} value={item.coin} className="pay-option">
                <img className="pay-option-logo" src={item.logo} alt="" width={28} height={28} />
                <span className="pay-option-body">
                  {/* BNB's name is its symbol: say it once. */}
                  <span className="pay-option-title">{item.coin}{item.label !== item.coin && <> <span className="pay-option-name">{item.label}</span></>}</span>
                  <span className="pay-option-hint">
                    {item.kind === "stablecoin" ? `${formatUsd(order.priceUsd)} in ${item.coin} · ${item.standard}` : `Priced at the market rate, locked for ${ORDER_TTL_MINUTES} minutes`}
                  </span>
                </span>
                <RadioGroup.Indicator className="pay-option-check"><Check size={16} aria-hidden="true" /></RadioGroup.Indicator>
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
        </fieldset>
      )}

      {network && coin && (
        <div className="pay-step">
          <h3 className="pay-step-title"><span className="pay-step-index" aria-hidden="true">3</span>Payment details</h3>
          {/* The step can't be undone: the button names both choices (an arrow key in step 1 changes the network, and USDT or USDC stays picked). */}
          <Button variant="primary" size="lg" block busy={busy} aria-disabled={blocked || undefined} onClick={() => onChoose(network.id, coin.coin)}>
            {busy ? `Getting the details for ${coin.coin} on ${network.label}…` : `Get payment details for ${coin.coin} on ${network.label}`}
          </Button>
          <p className="field-hint">
            The wallet address and the exact amount appear here, valid for {ORDER_TTL_MINUTES} minutes. Once they're issued, this order's network and coin can't be changed.
          </p>
        </div>
      )}
    </div>
  );
}
