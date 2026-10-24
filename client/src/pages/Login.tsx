import { useState } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { BrandMark } from "@/components/shell/AppShell";
import { authApi } from "@/lib/api";

export default function Login({ configured, onSignedIn }: { configured: boolean; onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.login(password);
      onSignedIn();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <BrandMark size={34} />
        <h1>Sign in to Curialy</h1>
        <p className="muted" style={{ margin: "0 0 20px", fontSize: 13 }}>This workspace runs an autonomous agent that executes code on this server, so it is restricted to the operator.</p>
        {!configured && <div className="alert warn" style={{ marginBottom: 14 }}>Admin login is not configured. Set ADMIN_PASSWORD_HASH and SESSION_SECRET in /etc/curialyai.env.</div>}
        <label className="eyebrow" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={event => setPassword(event.target.value)} style={{ marginTop: 6 }} />
        {error && <div className="alert error" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn primary" type="submit" disabled={busy || !password || !configured} style={{ width: "100%", marginTop: 16, height: 38 }}>
          {busy ? <Loader2 size={15} className="spin" /> : <LockKeyhole size={15} />} Sign in
        </button>
      </form>
    </main>
  );
}
