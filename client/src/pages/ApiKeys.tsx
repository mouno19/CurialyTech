import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { agentApi, type KeyStatus } from "@/lib/api";

export default function ApiKeys() {
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);
  useEffect(() => { agentApi.keys().then(data => setKeys(data.keys)).catch(() => setKeys([])); }, []);
  return (
    <AppShell title="API Key Manager">
      <div className="page">
        <div className="page-narrow">
          <p className="page-sub">Credentials are server-side only and never reach the browser. Only the last four characters are displayed.</p>
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th /><th>Credential</th><th>Value</th></tr></thead>
                <tbody>
                  {(keys ?? []).map(key => (
                    <tr key={key.id}>
                      <td>{key.configured ? <CheckCircle2 size={16} color="var(--mint)" /> : <CircleAlert size={16} color="var(--amber)" />}</td>
                      <td><div>{key.label}</div>{key.note && <div className="faint" style={{ fontSize: 11.5 }}>{key.note}</div>}</td>
                      <td className="num">{key.masked ?? <span className="faint">missing</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="alert info" style={{ marginTop: 16 }}>
            <KeyRound size={15} style={{ flex: "0 0 auto", marginTop: 1 }} />
            <span>Credentials are held in the server's protected environment and are never sent to the browser. Rotation is an operator task (see the operations runbook); change the admin password with <code>node scripts/set-admin-password.mjs</code>.</span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
