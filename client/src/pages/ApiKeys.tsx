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
          <p className="page-sub">Credentials are server-side only and never reach the browser. They are read from root-owned environment files at service start; to rotate one, edit the file shown and restart the service. Only the last four characters are displayed.</p>
          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th /><th>Credential</th><th>Variable</th><th>Stored in</th><th>Value</th></tr></thead>
                <tbody>
                  {(keys ?? []).map(key => (
                    <tr key={key.id}>
                      <td>{key.configured ? <CheckCircle2 size={16} color="var(--mint)" /> : <CircleAlert size={16} color="var(--amber)" />}</td>
                      <td><div>{key.label}</div>{key.note && <div className="faint" style={{ fontSize: 11.5 }}>{key.note}</div>}</td>
                      <td className="num">{key.envVar}</td>
                      <td className="num">{key.location}</td>
                      <td className="num">{key.masked ?? <span className="faint">missing</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="alert info" style={{ marginTop: 16 }}>
            <KeyRound size={15} style={{ flex: "0 0 auto", marginTop: 1 }} />
            <span>Rotate: <code>sudoedit /etc/curialyai.env</code> then <code>sudo systemctl restart curialyai</code>. The Snowflake PAT lives in <code>/etc/snowflake-proxy.env</code> (restart <code>snowflake-proxy</code>). Change the admin password with <code>node scripts/set-admin-password.mjs</code>.</span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
