import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A token's hex value (a QR image takes colours, not CSS variables); undefined keeps qrcode's black and white. */
function tokenHex(name: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

/** A QR code of the wallet address alone: it fills in neither the amount nor the network, and says so. */
export function AddressQr({ address, amount, coin }: { address: string; amount: string; coin: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc(null);
    setFailed(false);
    // Drawn at twice the size it is shown, for sharp edges on high-density screens.
    QRCode.toDataURL(address, { width: 352, margin: 3, errorCorrectionLevel: "M", color: { dark: tokenHex("--ink"), light: tokenHex("--composer") } })
      .then(url => { if (active) setSrc(url); }, () => { if (active) setFailed(true); });
    return () => {
      active = false;
    };
  }, [address]);

  return (
    <figure className="pay-qr">
      <div className="pay-qr-frame">
        {src ? <img src={src} width={176} height={176} alt={`QR code of the wallet address ${address}`} /> : failed ? <p className="pay-qr-failed">The QR code couldn't be drawn here. Copy the address instead.</p> : <span className="skeleton pay-qr-skeleton" aria-hidden="true" />}
      </div>
      <figcaption className="field-hint">This QR code holds the wallet address only. Type the amount yourself: <strong className="mono">{amount} {coin}</strong>.</figcaption>
    </figure>
  );
}
