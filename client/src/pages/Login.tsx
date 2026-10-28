import { useId, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Eye, EyeOff, TriangleAlert } from "lucide-react";
import { Wordmark } from "@/components/brand/Logo";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { authApi, errorMessage } from "@/lib/api";

/** onSignedIn resolves once the session is confirmed, or throws a message to show here. */
export default function Login({ configured, onSignedIn }: { configured: boolean; onSignedIn: () => Promise<void> | void }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !password || !configured) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.login(password);
      await onSignedIn();
    } catch (loginError) {
      setError(errorMessage(loginError, "Sign-in failed. Try again."));
      setBusy(false);
    }
  };

  return (
    <main className="login grid-paper grain">
      <Link href="/" className="login-home m-nudge"><ArrowLeft size={15} aria-hidden="true" />Curialy home</Link>
      <div className="login-column">
        <span className="login-mark m-settle"><Wordmark size="lg" /></span>
        <form className="card login-card lp-login-rise" onSubmit={submit} noValidate>
          <h1 className="serif-title">Sign in</h1>
          <p className="muted login-note">This workspace runs an autonomous agent that executes code on this server, so access is limited to its operator.</p>
          {!configured && (
            <div className="notice" data-tone="warning" role="status">
              <TriangleAlert size={16} aria-hidden="true" />
              <div className="notice-body">Sign-in isn't set up on this server yet. The operator needs to set an admin password before anyone can sign in.</div>
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="password">Password</label>
            <div className="input-wrap">
              <input
                id="password"
                className="input"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                required
                disabled={!configured}
                value={password}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={event => setPassword(event.target.value)}
              />
              <IconButton
                className="input-end"
                size="sm"
                label="Show password"
                icon={visible ? EyeOff : Eye}
                aria-pressed={visible}
                disabled={!configured}
                onClick={() => setVisible(value => !value)}
              />
            </div>
          </div>
          {error && (
            <p id={errorId} className="field-error" role="alert">
              <TriangleAlert size={14} aria-hidden="true" />
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" block busy={busy} disabled={!configured || !password} iconEnd={ArrowRight}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
