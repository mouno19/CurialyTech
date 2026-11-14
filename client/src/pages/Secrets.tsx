import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, LockKeyhole, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StateNotice } from "@/components/common/StateNotice";
import { errorMessage, relativeTime, secretsApi, type SavedSecret } from "@/lib/api";

// Secrets the account saves for its tasks. A value goes in once and never comes back: not to this
// page, not to the agent. A task gets it as an environment variable when the agent asks for it by
// name (request_secret).

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const MIN_CHARS = 6;

/** Typed names become variable names: STRIPE KEY → STRIPE_KEY. */
const asName = (text: string) => text.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+/, "").slice(0, 64);

function SecretValueField({ id, value, onChange, disabled }: { id: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="request-secret-field">
      <input
        id={id}
        className="input mono"
        type={shown ? "text" : "password"}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="Paste or type the value"
        autoComplete="new-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        disabled={disabled}
      />
      <button type="button" className="icon-btn sm" onClick={() => setShown(current => !current)} aria-label={shown ? "Hide the value" : "Show the value"} aria-pressed={shown} disabled={disabled}>
        {shown ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Add one, or replace the value of `fixedName`. */
function SecretForm({ fixedName, onSaved, onCancel }: { fixedName?: string; onSaved: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(fixedName ?? "");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), value: useId(), note: useId() };
  const nameError = name && !NAME.test(name) ? "Start with a letter; use capital letters, digits and _." : null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!NAME.test(name) || value.length < MIN_CHARS || busy) return;
    setBusy(true);
    setError(null);
    const typed = value;
    setValue("");
    try {
      await secretsApi.save(name, typed, note.trim() || undefined);
      toast.success(fixedName ? `${name} replaced.` : `${name} saved.`);
      if (!fixedName) { setName(""); setNote(""); }
      onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError, "Couldn't save the secret."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="secret-form" onSubmit={event => void submit(event)} autoComplete="off">
      {!fixedName && (
        <div className="field">
          <label className="field-label" htmlFor={ids.name}>Name</label>
          <input id={ids.name} className="input mono" value={name} onChange={event => setName(asName(event.target.value))} placeholder="STRIPE_SECRET_KEY" autoComplete="off" spellCheck={false} aria-invalid={Boolean(nameError) || undefined} />
          <span className="field-hint">{nameError ?? "The agent asks for it by this name, and commands read it as $NAME."}</span>
        </div>
      )}
      <div className="field">
        <label className="field-label" htmlFor={ids.value}>{fixedName ? `New value for ${fixedName}` : "Value"}</label>
        <SecretValueField id={ids.value} value={value} onChange={setValue} disabled={busy} />
        <span className="field-hint">{value && value.length < MIN_CHARS ? `At least ${MIN_CHARS} characters.` : "Encrypted when saved. It is never shown again, here or to the agent."}</span>
      </div>
      {!fixedName && (
        <div className="field">
          <label className="field-label" htmlFor={ids.note}>Note <span className="field-hint">(optional)</span></label>
          <input id={ids.note} className="input" value={note} maxLength={200} onChange={event => setNote(event.target.value)} placeholder="Test-mode key for the shop project" />
        </div>
      )}
      {error && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{error}</p>}
      <div className="request-actions">
        <Button type="submit" variant="primary" icon={fixedName ? RotateCcw : Plus} busy={busy} disabled={!NAME.test(name) || value.length < MIN_CHARS}>{fixedName ? "Replace value" : "Save secret"}</Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function SecretRow({ secret, onChanged }: { secret: SavedSecret; onChanged: () => void }) {
  const [replacing, setReplacing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const remove = async () => {
    await secretsApi.remove(secret.name);
    toast.success(`${secret.name} deleted.`);
    onChanged();
  };
  return (
    <li className="secret-row">
      <div className="secret-row-main">
        <KeyRound size={15} aria-hidden="true" />
        <div className="secret-row-text">
          <span className="secret-name mono">{secret.name}</span>
          {secret.note && <span className="secret-note">{secret.note}</span>}
          <span className="secret-meta">Updated {relativeTime(secret.updatedAt)} · {secret.lastUsedAt ? `last used by a task ${relativeTime(secret.lastUsedAt)}` : "not used yet"}</span>
        </div>
        <div className="secret-row-actions">
          <Button size="sm" icon={RotateCcw} onClick={() => setReplacing(current => !current)} aria-expanded={replacing}>Replace</Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmOpen(true)}>Delete</Button>
        </div>
      </div>
      {replacing && <SecretForm fixedName={secret.name} onSaved={() => { setReplacing(false); onChanged(); }} onCancel={() => setReplacing(false)} />}
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={`Delete ${secret.name}?`} confirmLabel="Delete" busyLabel="Deleting…" tone="danger" onConfirm={remove}>
        Tasks can no longer use it; the agent will ask for it again when it's needed. A task that already has it keeps it for up to an hour.
      </ConfirmDialog>
    </li>
  );
}

export default function Secrets() {
  const [data, setData] = useState<Awaited<ReturnType<typeof secretsApi.list>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    secretsApi.list().then(setData, loadError => setError(errorMessage(loadError, "Couldn't load your secrets.")));
  }, []);
  useEffect(() => load(), [load]);

  return (
    <AppShell title="Secrets">
      <div className="page">
        <div className="page-narrow">
          <header className="page-head">
            <div>
              <span className="eyebrow">Security</span>
              <h2 className="page-title">Secrets</h2>
              <p className="page-sub">API keys, tokens and passwords your tasks can use. Values are encrypted and never shown again, not to you and not to the agent: when a task needs one, the agent asks for it by name and its commands get it as an environment variable, wiped from every log.</p>
            </div>
          </header>

          {data === null ? (
            error ? (
              <div className="card"><StateNotice variant="error" title="Couldn't load your secrets" actions={<Button variant="primary" icon={RotateCcw} onClick={load}>Try again</Button>}>{error}</StateNotice></div>
            ) : (
              <div className="card secret-card"><p className="sr-only" role="status">Loading…</p><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>
            )
          ) : !data.configured ? (
            <div className="card"><StateNotice variant="empty" title="Secrets aren't set up on this server">An operator needs to set the encryption key first.</StateNotice></div>
          ) : (
            <>
              <section className="card secret-card" aria-labelledby="secret-add-title">
                <h3 id="secret-add-title" className="secret-card-title"><LockKeyhole size={16} aria-hidden="true" />Add a secret</h3>
                {data.secrets.length >= data.limits.max ? <p className="field-hint">You've saved the most secrets an account can have ({data.limits.max}). Delete one to add another.</p> : <SecretForm onSaved={load} />}
              </section>
              <section className="card secret-card" aria-labelledby="secret-list-title">
                <h3 id="secret-list-title" className="secret-card-title">Saved secrets <span className="secret-count">{data.secrets.length} of {data.limits.max}</span></h3>
                {data.secrets.length === 0 ? (
                  <StateNotice variant="empty" size="sm" title="No secrets yet">Add one above, or tick "save it to my secrets" when the agent asks for one in a task.</StateNotice>
                ) : (
                  <ul className="secret-list">{data.secrets.map(secret => <SecretRow key={secret.name} secret={secret} onChanged={load} />)}</ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
