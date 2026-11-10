import { ExternalLink, TriangleAlert } from "lucide-react";
import { coinOn, formatUsd, networkInfo, type PaymentOrder } from "@shared/billing";
import { clockText } from "@/lib/account";
import { AddressQr } from "./AddressQr";
import { CopyButton } from "./CopyButton";
import { addressParts, methodText } from "./orderState";

/** A coin's quote as precise as the amount was priced: "$0.2345" under a dollar (cents alone would be percent off), "$3,012.50" above. */
const quoteText = (usd: number) => (usd < 1 ? `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : formatUsd(usd));

/**
 * What to send and where, once the details are issued: the exact amount, the network and token
 * standard, the wallet (with the characters to check after pasting), its QR code, the real token's
 * contract, a short guide and the mistakes that can't be matched automatically.
 */
export function PaymentDetails({ order, onCopied }: { order: PaymentOrder; onCopied: (message: string) => void }) {
  const network = networkInfo(order.network);
  const entry = coinOn(order.network, order.coin);
  if (!network || !entry || !order.payAddress || !order.expectedAmount) return null;
  const address = order.payAddress;
  const amount = order.expectedAmount;
  const coin = entry.coin;
  const stable = entry.kind === "stablecoin";
  const parts = addressParts(address);
  const quoted = order.quoteUsdPrice ? `Priced at ${quoteText(order.quoteUsdPrice)} per ${coin}${order.quotedAt ? ` at ${clockText(order.quotedAt)}` : ""} and locked until ${clockText(order.expiresAt)}. ` : "";
  // On EVM networks a native coin is matched only when sent straight to the wallet (a contract's transfer is internal to it).
  const directOnly = !stable && network.family === "evm";

  return (
    <div className="pay-details">
      <section className="pay-block" aria-labelledby="pay-amount-title">
        <h3 id="pay-amount-title" className="micro">Send exactly</h3>
        <div className="pay-amount-row">
          <p className="pay-amount"><span className="pay-amount-value">{amount}</span> <span className="pay-amount-coin">{coin}</span></p>
          <CopyButton value={amount} what="Amount" onCopied={onCopied} />
        </div>
        <p className="field-hint">
          {stable
            ? `That's ${formatUsd(order.priceUsd)} and a fraction of a cent: the last digits mark the payment as yours, so send them too.`
            : `${quoted}The last digits mark the payment as yours, so send them too.`}
        </p>
        <p className="pay-method"><img src={network.logo} alt="" width={18} height={18} />{methodText(order.network, order.coin)}</p>
      </section>

      <section className="pay-block" aria-labelledby="pay-wallet-title">
        <h3 id="pay-wallet-title" className="micro">To this wallet</h3>
        <div className="pay-wallet">
          <code className="pay-address">{parts.prefix}<strong>{parts.head}</strong>{parts.middle}<strong>{parts.tail}</strong></code>
          <CopyButton value={address} what="Address" onCopied={onCopied} />
        </div>
        {parts.tail && (
          <p className="field-hint">
            After pasting it, check that it starts with <strong className="mono">{parts.prefix}{parts.head}</strong> and ends with <strong className="mono">{parts.tail}</strong>: some scams plant look-alike addresses in wallet histories.
          </p>
        )}
        <AddressQr address={address} amount={amount} coin={coin} />
      </section>

      {stable && entry.tokens.length > 0 && (
        <section className="pay-block" aria-labelledby="pay-token-title">
          <h3 id="pay-token-title" className="micro">The real {coin}</h3>
          <p className="pay-text">Wallets can list look-alike tokens with the same name. Pick the {coin} whose contract is {entry.tokens.length > 1 ? "one of these" : "this one"}:</p>
          <ul className="pay-tokens">
            {entry.tokens.map(token => (
              <li key={token}>
                <code className="pay-token">{token}</code>
                <a className="link pay-token-link" href={`${network.explorer.address}${token}`} target="_blank" rel="noopener noreferrer">
                  Check on {network.explorer.name}<ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pay-block" aria-labelledby="pay-guide-title">
        <h3 id="pay-guide-title" className="micro">How to pay</h3>
        <ol className="pay-guide">
          <li>Open your wallet or exchange and choose Send (on an exchange, Withdraw).</li>
          <li>Pick {coin} on {network.label}{stable ? ` (${entry.standard})` : ""}.</li>
          <li>Paste the address above and check its first and last 6 characters.</li>
          <li>Send exactly <strong className="mono">{amount} {coin}</strong>.</li>
          <li>Copy the transaction hash and paste it below.</li>
        </ol>
      </section>

      <div className="notice" data-tone="warning">
        <TriangleAlert size={16} aria-hidden="true" />
        <div className="notice-body">
          <strong className="notice-title">Before you send</strong>
          <ul className="pay-warnings">
            <li>Send the exact amount: more or less can't be matched to this order.</li>
            <li>Only {coin} on {network.label}. Another coin or network can't be matched automatically.</li>
            <li>An exchange that takes its withdrawal fee out of the amount must still deliver exactly {amount} {coin}: add the fee on top.</li>
            {directOnly && <li>Send {coin} straight from a wallet address. A transfer made through a contract (a smart wallet, some exchange withdrawals) can't be matched automatically: it's checked by hand, which takes longer.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
