import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, RotateCcw, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import { agentApi, errorMessage, type KeyStatus } from "@/lib/api";

/** "••••abcd" reads as four bullets to a screen reader; say what it means instead. */
function spokenValue(masked: string) {
  const tail = /^•+(.+)$/.exec(masked)?.[1];
  return tail ? `ends in ${tail.split("").join(" ")}` : masked;
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    agentApi.keys().then(data => setKeys(data.keys), loadError => setError(errorMessage(loadError, "Couldn't load the credentials.")));
  }, []);
  useEffect(() => load(), [load]);

  const missing = keys?.filter(key => !key.configured).length ?? 0;
  return (
    <AppShell title="API Key Manager">
      <div className="page">
        <div className="page-narrow">
          <header className="page-head">
            <div>
              <span className="eyebrow">Credentials</span>
              <h2 className="page-title">API Key Manager</h2>
              <p className="page-sub">The server-side credentials the agent uses. Values never reach the browser: only the last characters, or whether a value is set, are shown.</p>
            </div>
          </header>

          {keys === null ? (
            error ? (
              <div className="card">
                <StateNotice variant="error" title="Couldn't load the credentials" actions={<Button variant="primary" icon={RotateCcw} onClick={load}>Try again</Button>}>{error}</StateNotice>
              </div>
            ) : (
              <div className="card key-list-card">
                <p className="sr-only" role="status">Loading credentials…</p>
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="key-row" aria-hidden="true">
                    <span className="skeleton key-skeleton-status" />
                    <span className="skeleton skeleton-text key-skeleton-label" />
                    <span className="skeleton skeleton-text key-skeleton-value" />
                  </div>
                ))}
              </div>
            )
          ) : (
            <>
              <p className="key-summary">
                {missing === 0 ? `All ${keys.length} credentials are set.` : `${keys.length - missing} of ${keys.length} credentials are set; ${missing} ${missing === 1 ? "is" : "are"} missing.`}
              </p>
              <ul className="card key-list-card" aria-label="Credentials">
                {keys.map(key => (
                  <li key={key.id} className="key-row" data-configured={key.configured || undefined}>
                    <span className="status-badge key-status" data-tone={key.configured ? "success" : "warning"} data-size="sm">
                      {key.configured ? <Check size={12} aria-hidden="true" /> : <TriangleAlert size={12} aria-hidden="true" />}
                      {key.configured ? "Set" : "Missing"}
                    </span>
                    <div className="key-main">
                      <span className="key-label">{key.label}</span>
                      {key.note && <span className="key-note">{key.note}</span>}
                    </div>
                    {key.masked ? (
                      <code className="key-value">
                        <span aria-hidden="true">{key.masked}</span>
                        <span className="sr-only">{spokenValue(key.masked)}</span>
                      </code>
                    ) : (
                      <span className="key-value" data-empty="">Not set</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="notice key-help" data-tone="info">
            <KeyRound size={16} aria-hidden="true" />
            <div className="notice-body">
              <p className="notice-title">Changing a credential</p>
              <p>Credentials live in the server's protected environment and are never sent to the browser. Rotating one is an operator task (see the operations runbook); change the admin password with <code>node scripts/set-admin-password.mjs</code>.</p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
