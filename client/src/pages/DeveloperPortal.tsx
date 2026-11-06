import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Check, Copy, KeyRound, Plus, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Dialog } from "@/components/common/Dialog";
import { StateNotice } from "@/components/common/StateNotice";
import { developerApi, errorMessage } from "@/lib/api";
import { GATEWAY_BASE_URL, GATEWAY_MODEL_IDS, GATEWAY_MODELS, type ApiKeyInfo } from "@shared/gateway";

// The Developer API page: the endpoint, the account's keys (created here, shown once, revoked
// here) and code to copy. Keys are secrets: after the reveal dialog closes, only a prefix remains.

const ORIGIN = GATEWAY_BASE_URL.replace(/\/v1$/, "");

const SAMPLES = [
  {
    id: "curl",
    label: "cURL",
    code: `curl ${GATEWAY_BASE_URL}/messages \\
  -H "x-api-key: $CURIALY_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-opus-5-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
  },
  {
    id: "python-anthropic",
    label: "Python · Anthropic SDK",
    code: `import os
import anthropic

# Anthropic SDKs add /v1 themselves: give them the site, not the /v1 URL.
client = anthropic.Anthropic(
    base_url="${ORIGIN}",
    api_key=os.environ["CURIALY_API_KEY"],
)
message = client.messages.create(
    model="claude-opus-5-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
# A reply can start with a thinking block: print its text blocks.
print("".join(block.text for block in message.content if block.type == "text"))`,
  },
  {
    id: "python-openai",
    label: "Python · OpenAI SDK",
    code: `import os
from openai import OpenAI

client = OpenAI(base_url="${GATEWAY_BASE_URL}", api_key=os.environ["CURIALY_API_KEY"])
response = client.chat.completions.create(
    model="claude-opus-5-5",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
  },
  {
    id: "node",
    label: "Node.js",
    code: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${ORIGIN}",
  apiKey: process.env.CURIALY_API_KEY,
});

const message = await client.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
// A reply can start with a thinking block: print its text blocks.
console.log(message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join(""));`,
  },
];

const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const moment = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy here: select the text and copy it yourself.");
  }
}

function CopyField({ value, what }: { value: string; what: string }) {
  return (
    <div className="dev-copy">
      <code>{value}</code>
      <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copy(value, what)} aria-label={`Copy the ${what.toLowerCase()}`}>Copy</Button>
    </div>
  );
}

function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (created: { key: ApiKeyInfo; secret: string }) => void }) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [models, setModels] = useState<string[]>(GATEWAY_MODEL_IDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName("");
    setModels(GATEWAY_MODEL_IDS);
    setError(null);
  }, [open]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Name the key, for example after the app that will use it.");
    if (!models.length) return setError("Choose at least one model.");
    setBusy(true);
    setError(null);
    try {
      onCreated(await developerApi.create(name.trim(), models));
    } catch (failure) {
      setError(errorMessage(failure, "Couldn't create the key."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!busy}
      title="Create an API key"
      description="Name it after the app or environment that will use it, so you can tell keys apart later."
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" form={`${nameId}-form`} icon={KeyRound} busy={busy}>Create key</Button>
        </>
      )}
    >
      <form id={`${nameId}-form`} className="stack" onSubmit={event => void submit(event)} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={nameId}>Name</label>
          <input id={nameId} className="input" value={name} maxLength={60} placeholder="Production app" autoComplete="off" onChange={event => setName(event.target.value)} />
        </div>
        <fieldset className="field dev-fieldset">
          <legend className="field-label">Models this key may call</legend>
          {GATEWAY_MODELS.map(model => (
            <label key={model.id} className="dev-check">
              <input type="checkbox" checked={models.includes(model.id)} onChange={event => setModels(current => (event.target.checked ? [...current, model.id] : current.filter(id => id !== model.id)))} />
              <span>{model.label}</span>
              <code>{model.id}</code>
            </label>
          ))}
        </fieldset>
        {error && <p className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{error}</p>}
      </form>
    </Dialog>
  );
}

function RevealKeyDialog({ created, onDone }: { created: { key: ApiKeyInfo; secret: string } | null; onDone: () => void }) {
  return (
    <Dialog
      open={created !== null}
      onOpenChange={open => { if (!open) onDone(); }}
      dismissible={false}
      title="Save your new key"
      description="This is the only time it is shown. Store it in your app's secret settings or a password manager; if it is lost, create a new key and revoke this one."
      footer={<Button variant="primary" icon={Check} onClick={onDone}>I've saved it</Button>}
    >
      {created && (
        <div className="stack">
          <code className="dev-secret" aria-label={`API key for ${created.key.name}`}>{created.secret}</code>
          <Button variant="secondary" icon={Copy} onClick={() => void copy(created.secret, "API key")}>Copy key</Button>
          <p className="field-hint">Treat it like a password: anyone with it can spend this account's credits. Never put it in code you publish or in a web page.</p>
        </div>
      )}
    </Dialog>
  );
}

function KeyRow({ apiKey, onRevoke }: { apiKey: ApiKeyInfo; onRevoke: (key: ApiKeyInfo) => void }) {
  const active = apiKey.status === "active";
  return (
    <li className="dev-key" data-revoked={active ? undefined : ""}>
      <div className="dev-key-main">
        <span className="dev-key-name">{apiKey.name}</span>
        <span className="dev-key-meta">
          Created {day.format(new Date(apiKey.createdAt))} · {apiKey.lastUsedAt ? `last used ${moment.format(new Date(apiKey.lastUsedAt))}` : "never used"}
        </span>
      </div>
      <code className="dev-key-prefix" aria-label={`Key starting ${apiKey.prefix}`}>{apiKey.prefix}…</code>
      <ul className="dev-models dev-key-models" aria-label="Models">
        {apiKey.allowedModels.map(id => <li key={id} className="chip mono">{id}</li>)}
      </ul>
      {active ? (
        <Button size="sm" variant="danger" onClick={() => onRevoke(apiKey)} aria-label={`Revoke ${apiKey.name}`}>Revoke</Button>
      ) : (
        <span className="status-badge" data-tone="neutral" data-size="sm">Revoked</span>
      )}
    </li>
  );
}

export default function DeveloperPortal() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ key: ApiKeyInfo; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyInfo | null>(null);
  const load = useCallback(() => {
    setError(null);
    developerApi.keys().then(data => setKeys(data.keys), failure => setError(errorMessage(failure, "Couldn't load your keys.")));
  }, []);
  useEffect(() => load(), [load]);

  const active = keys?.filter(key => key.status === "active").length ?? 0;
  return (
    <AppShell title="Developer API">
      <div className="page">
        <div className="page-narrow dev-page">
          <header className="page-head">
            <div>
              <span className="eyebrow">Developer API</span>
              <h2 className="page-title">Call Curialy's models from your code</h2>
              <p className="page-sub">Create a key, point an Anthropic or OpenAI SDK at Curialy, and send requests from your own apps. Usage is charged to this account's credits at the same rates as the agent's own work.</p>
            </div>
          </header>

          <section className="card" aria-labelledby="dev-endpoint">
            <div className="card-head"><h2 id="dev-endpoint">Endpoint</h2></div>
            <div className="dev-endpoint">
              <div className="field">
                <span className="field-label">Base URL</span>
                <CopyField value={GATEWAY_BASE_URL} what="Base URL" />
                <span className="field-hint">For OpenAI SDKs and plain HTTP. Anthropic SDKs add <code>/v1</code> themselves, so they take <code>{ORIGIN}</code>.</span>
              </div>
              <div className="field">
                <span className="field-label">Models</span>
                <ul className="dev-models" aria-label="Supported models">
                  {GATEWAY_MODELS.map(model => <li key={model.id} className="chip mono" title={model.label}>{model.id}</li>)}
                </ul>
              </div>
              <p className="field-hint">Send the key as <code>x-api-key</code> or <code>Authorization: Bearer</code>. Both <code>/v1/messages</code> (Anthropic) and <code>/v1/chat/completions</code> (OpenAI) are available, streamed or whole, and <code>/v1/models</code> lists what a key may use.</p>
            </div>
          </section>

          <section className="card" aria-labelledby="dev-keys">
            <div className="card-head">
              <h2 id="dev-keys">API keys{keys && active > 0 ? <span className="badge">{active}</span> : null}</h2>
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>Create key</Button>
            </div>
            {keys === null ? (
              error ? (
                <StateNotice variant="error" title="Couldn't load your keys" actions={<Button variant="primary" icon={RotateCcw} onClick={load}>Try again</Button>}>{error}</StateNotice>
              ) : (
                <div className="dev-keys" aria-hidden="true">
                  <p className="sr-only" role="status">Loading your keys…</p>
                  {[0, 1].map(index => <div key={index} className="dev-key"><span className="skeleton skeleton-text" /><span className="skeleton skeleton-text" /></div>)}
                </div>
              )
            ) : keys.length === 0 ? (
              <StateNotice variant="empty" title="No keys yet">Create a key to call the API from your code. Each key shows its secret once, when you create it.</StateNotice>
            ) : (
              <ul className="dev-keys" aria-label="Your API keys">
                {keys.map(key => <KeyRow key={key.id} apiKey={key} onRevoke={setRevoking} />)}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="dev-quickstart">
            <div className="card-head"><h2 id="dev-quickstart">Quickstart</h2></div>
            <Tabs.Root defaultValue="curl" className="dev-samples">
              <Tabs.List className="tabs" aria-label="Code samples">
                {SAMPLES.map(sample => <Tabs.Trigger key={sample.id} value={sample.id} className="tab">{sample.label}</Tabs.Trigger>)}
              </Tabs.List>
              {SAMPLES.map(sample => (
                <Tabs.Content key={sample.id} value={sample.id} className="tab-panel dev-sample">
                  <pre className="code-block"><code>{sample.code}</code></pre>
                  <Button size="sm" variant="secondary" icon={Copy} className="dev-sample-copy" onClick={() => void copy(sample.code, "Code")} aria-label={`Copy the ${sample.label} sample`}>Copy</Button>
                </Tabs.Content>
              ))}
            </Tabs.Root>
            <p className="field-hint dev-samples-note">The samples read the key from the <code>CURIALY_API_KEY</code> environment variable, so it never sits in your code.</p>
          </section>
        </div>
      </div>

      <CreateKeyDialog open={creating} onOpenChange={setCreating} onCreated={result => { setCreating(false); setCreated(result); setKeys(current => [result.key, ...(current ?? [])]); }} />
      <RevealKeyDialog created={created} onDone={() => setCreated(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={open => { if (!open) setRevoking(null); }}
        title={revoking ? `Revoke ${revoking.name}?` : "Revoke key?"}
        confirmLabel="Revoke key"
        busyLabel="Revoking…"
        tone="danger"
        onConfirm={async () => {
          if (!revoking) return;
          const { key } = await developerApi.revoke(revoking.id);
          setKeys(current => current?.map(entry => (entry.id === key.id ? key : entry)) ?? null);
          toast.success(`${key.name} revoked`);
        }}
      >
        Apps using this key stop working at once. This can't be undone; create a new key if you need one again.
      </ConfirmDialog>
    </AppShell>
  );
}
