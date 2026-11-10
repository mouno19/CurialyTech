import { useId, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, ChevronDown, Eye, EyeOff, TriangleAlert } from "lucide-react";
import { GitHubMark } from "@/components/common/GitHubMark";
import { Wordmark } from "@/components/brand/Logo";
import { Button } from "@/components/common/Button";
import { IconButton } from "@/components/common/IconButton";
import { authApi, errorMessage } from "@/lib/api";

/** Why GitHub sent the visitor back without a session (the callback's ?signin= value). */
const SIGNIN_ERRORS: Record<string, string> = {
  banned: "This account can't sign in. If you think that's a mistake, contact the operator.",
  closed: "Sign-ups are closed right now. Accounts that already exist can still sign in.",
  access_denied: "GitHub sign-in was cancelled.",
  state_mismatch: "That sign-in took too long or was opened in another browser. Try again.",
  not_configured: "GitHub sign-in isn't set up on this server yet.",
  busy: "Too many sign-in attempts from this network. Wait a few minutes, then try again.",
};

/** Where to land after signing in: the address that asked for it (a shared task link), else the dashboard. */
function nextPath() {
  const { pathname, search } = window.location;
  if (pathname === "/login" || pathname === "/welcome") return "/";
  const params = new URLSearchParams(search);
  params.delete("signin");
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ""}`;
}

/** onSignedIn resolves once the session is confirmed, or throws a message to show here. */
export default function Login({ configured, github, signupsOpen, onSignedIn }: { configured: boolean; github: boolean; signupsOpen: boolean; onSignedIn: () => Promise<void> | void }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = new URLSearchParams(window.location.search).get("signin");
  const signinError = reason ? SIGNIN_ERRORS[reason] ?? "GitHub sign-in didn't work. Try again." : null;
  // Operators who arrived without GitHub sign-in available see their form open.
  const [operatorOpen, setOperatorOpen] = useState(!github);
  const errorId = useId();
  const operatorId = useId();

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
        <div className="card login-card lp-login-rise">
          <h1 className="serif-title">Sign in</h1>
          <p className="muted login-note">
            {signupsOpen ? "New here? Signing in with GitHub creates your account. It's free to start." : "Sign in with the GitHub account you use on Curialy."}
          </p>
          {signinError && (
            <div className="notice" data-tone="warning" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <div className="notice-body">{signinError}</div>
            </div>
          )}
          {github ? (
            <a className="btn primary lg block login-github" href={`/api/auth/github/login?next=${encodeURIComponent(nextPath())}`}>
              <GitHubMark />
              Continue with GitHub
            </a>
          ) : (
            <Button variant="primary" size="lg" block disabled>GitHub sign-in isn't set up yet</Button>
          )}
          <p className="field-hint login-scopes">Curialy asks GitHub only for your profile and email. Access to your repositories is a separate step, when you connect them.</p>

          <div className="login-operator">
            <button type="button" className="login-operator-toggle" aria-expanded={operatorOpen} aria-controls={operatorId} onClick={() => setOperatorOpen(open => !open)}>
              Operator sign-in
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {operatorOpen && (
              <form id={operatorId} className="login-operator-form" onSubmit={submit} noValidate>
                {!configured && (
                  <div className="notice" data-tone="warning" role="status">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <div className="notice-body">Password sign-in isn't set up on this server.</div>
                  </div>
                )}
                <div className="field">
                  <label className="field-label" htmlFor="password">Operator password</label>
                  <div className="input-wrap">
                    <input
                      id="password"
                      className="input"
                      type={visible ? "text" : "password"}
                      autoComplete="current-password"
                      autoFocus={!github}
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
                <Button type="submit" variant="secondary" block busy={busy} disabled={!configured || !password} iconEnd={ArrowRight}>
                  {busy ? "Signing in…" : "Sign in as operator"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
