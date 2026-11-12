import { formatPrice } from "./plans";

/** The balance a payment adds, at the top-up rate (`$5` paid at `100` is `$500`). */
export const topUpWorth = (paidUsd: number, creditPerUsd: number) => paidUsd * creditPerUsd;

/**
 * A top-up the way a plan price is shown: the balance crossed out, and the amount you pay beside it.
 * worthUsd overrides the rate when an order already stored the balance it will add.
 */
export function TopUpPrice({ paidUsd, creditPerUsd, worthUsd, variant = "deal" }: { paidUsd: number; creditPerUsd: number; worthUsd?: number; variant?: "deal" | "choice" | "note" }) {
  const worth = worthUsd ?? topUpWorth(paidUsd, creditPerUsd);
  const deal = worth > paidUsd;
  return (
    <span className={`topup-price topup-price-${variant}`}>
      {deal && <s className="topup-worth"><span className="sr-only">Balance </span>{formatPrice(worth)}</s>}
      <span className="topup-pay"><span className="sr-only">{deal ? "You pay " : "Price "}</span>{formatPrice(paidUsd)}</span>
    </span>
  );
}
