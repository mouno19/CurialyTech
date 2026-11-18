import { useDeferredValue, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Tabs from "@radix-ui/react-tabs";
import { Check, ClipboardPaste, FileUp, Link2, Upload } from "lucide-react";
import { toast } from "sonner";
import { parseSkill, type ParsedSkill } from "@shared/skill-parser";
import { SAVED_SKILL_LIMITS, type SavedSkill } from "@shared/skills";
import { Button } from "@/components/common/Button";
import { cx } from "@/components/common/cx";
import { Dialog } from "@/components/common/Dialog";
import { Markdown } from "@/components/Markdown";
import { agentApi, errorMessage } from "@/lib/api";
import { rememberSavedSkills } from "@/lib/savedSkills";

// Skills from anywhere: a file (SKILL.md, .md, .txt, .yaml, or a .zip of skills), a link (a GitHub
// file, folder or repository, a gist, any raw .md), or pasted text. What was read is reviewed and
// edited here before it is saved; pasted text is read in the browser as it is typed.

type Source = "file" | "url" | "paste";
type Draft = ParsedSkill & { key: number; saved?: SavedSkill; error?: string };

const ACCEPT = ".md,.markdown,.txt,.yaml,.yml,.zip";
const count = (value: number) => value.toLocaleString("en-US");

export function ImportSkillDialog({ open, onOpenChange, room }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Skills the account can still save (SAVED_SKILL_LIMITS.maxPerAccount less those it has). */
  room: number;
}) {
  const [source, setSource] = useState<Source>("file");
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const deferredPaste = useDeferredValue(paste);

  const show = (skills: ParsedSkill[], left = 0) => {
    setDrafts(skills.map(skill => ({ ...skill, key: ++nextKey.current })));
    setActive(0);
    setSkipped(left);
    setView("edit");
  };

  // Pasted text is read as it is typed (the same reader the server uses).
  useEffect(() => {
    if (source !== "paste") return;
    const skill = deferredPaste.trim() ? parseSkill(deferredPaste) : null;
    show(skill ? [skill] : []);
    setError(null);
  }, [deferredPaste, source]); // eslint-disable-line react-hooks/exhaustive-deps

  // A fresh start each time it opens.
  useEffect(() => {
    if (!open) return;
    setSource("file");
    setUrl("");
    setPaste("");
    setDrafts([]);
    setError(null);
    setSkipped(0);
  }, [open]);

  const read = async (request: () => Promise<{ skills: ParsedSkill[]; skipped: number }>) => {
    if (reading) return;
    setReading(true);
    setError(null);
    try {
      const result = await request();
      show(result.skills.map(({ name, body, description, version, source: from }) => ({ name, body, description, version, source: from })), result.skipped);
    } catch (failure) {
      setDrafts([]);
      setError(errorMessage(failure, "Couldn't read that."));
    } finally {
      setReading(false);
    }
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    void read(() => agentApi.importSkills({ file }));
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    readFile(event.dataTransfer.files[0]);
  };

  const readUrl = (event: FormEvent) => {
    event.preventDefault();
    if (url.trim()) void read(() => agentApi.importSkills({ url: url.trim() }));
  };

  const draft = drafts[active];
  const patch = (key: number, change: Partial<Draft>) => setDrafts(current => current.map(item => (item.key === key ? { ...item, ...change, ...("name" in change || "body" in change ? { saved: undefined, error: undefined } : {}) } : item)));
  const fits = (item: Draft) => Boolean(item.name.trim()) && item.body.trim().length > 0 && item.body.trim().length <= SAVED_SKILL_LIMITS.body;
  const unsaved = drafts.filter(item => !item.saved);
  const savable = unsaved.filter(fits);

  const saveOne = async (item: Draft) => {
    try {
      const { skill } = await agentApi.saveSkill({ name: item.name.trim(), body: item.body.trim() });
      rememberSavedSkills(skill);
      setDrafts(current => current.map(entry => (entry.key === item.key ? { ...entry, saved: skill, error: undefined } : entry)));
      return skill;
    } catch (failure) {
      const message = errorMessage(failure, "Couldn't save that skill.");
      setDrafts(current => current.map(entry => (entry.key === item.key ? { ...entry, error: message } : entry)));
      return null;
    }
  };

  const save = async (items: Draft[]) => {
    if (saving || !items.length) return;
    setSaving(true);
    const saved: SavedSkill[] = [];
    for (const item of items.slice(0, Math.max(0, room))) {
      const skill = await saveOne(item);
      if (skill) saved.push(skill);
    }
    setSaving(false);
    if (saved.length === 1) toast.success(`Saved “${saved[0].name}” to your skills`, { description: "Attach it to a task from the composer's Skills menu." });
    else if (saved.length > 1) toast.success(`Saved ${saved.length} skills`, { description: "Attach them to a task from the composer's Skills menu." });
  };

  const over = draft ? draft.body.trim().length - SAVED_SKILL_LIMITS.body : 0;
  const full = room <= 0;

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }} size="lg" dismissible={!saving} title="Import a skill" description="From a file, a GitHub or web link, or pasted text. Review it, then save it to your skills.">
      <Tabs.Root value={source} onValueChange={value => { setSource(value as Source); setError(null); if (value !== "paste") setDrafts([]); }} className="skill-import">
        <Tabs.List className="tabs" aria-label="Where the skill comes from">
          <Tabs.Trigger value="file" className="tab"><FileUp size={14} aria-hidden="true" />Upload file</Tabs.Trigger>
          <Tabs.Trigger value="url" className="tab"><Link2 size={14} aria-hidden="true" />From GitHub or the web</Tabs.Trigger>
          <Tabs.Trigger value="paste" className="tab"><ClipboardPaste size={14} aria-hidden="true" />Paste text</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="file" className="tab-panel">
          <div
            className={cx("skill-drop", dragging && "dragging")}
            onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
            onDrop={onDrop}
          >
            <Upload size={20} aria-hidden="true" />
            <p className="skill-drop-lead">Drop a <code>SKILL.md</code>, a .md, .txt or .yaml file, or a .zip of skills</p>
            <p className="field-hint">Up to 1 MB a file and 5 MB for an archive; up to 10 skills at once.</p>
            <Button icon={FileUp} busy={reading} onClick={() => fileInput.current?.click()}>Choose a file</Button>
            <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={event => { readFile(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
        </Tabs.Content>

        <Tabs.Content value="url" className="tab-panel">
          <form className="skill-url" onSubmit={readUrl}>
            <label className="field">
              <span className="field-label" id="skill-url-label">Link</span>
              <input className="input" aria-labelledby="skill-url-label" inputMode="url" autoComplete="off" spellCheck={false} placeholder="github.com/owner/repo/tree/main/skills/my-skill" value={url} onChange={event => setUrl(event.target.value)} />
              <span className="field-hint">A GitHub file, folder or repository, a gist, or any public link to a .md, .txt, .yaml or .zip file.</span>
            </label>
            <Button type="submit" variant="primary" icon={Link2} busy={reading} aria-disabled={!url.trim() || undefined}>Inspect &amp; import</Button>
          </form>
        </Tabs.Content>

        <Tabs.Content value="paste" className="tab-panel">
          <label className="field">
            <span className="field-label" id="skill-paste-label">SKILL.md or markdown</span>
            <textarea className="textarea mono skill-paste" aria-labelledby="skill-paste-label" rows={8} spellCheck={false} placeholder={"---\nname: release-notes\ndescription: Write release notes from merged pull requests.\n---\n\n# Release notes\n1. List the merged pull requests…"} value={paste} onChange={event => setPaste(event.target.value)} />
            <span className="field-hint">Read as you type: the frontmatter name or the first # heading becomes the name, the rest the procedure.</span>
          </label>
        </Tabs.Content>
      </Tabs.Root>

      {error && <p className="field-error" role="alert">{error}</p>}

      {draft && (
        <section className="skill-review" aria-label="Review before saving">
          {drafts.length > 1 && (
            <div className="skill-review-found">
              <p className="field-hint">Found {drafts.length} skills{skipped ? ` (${skipped} more not read: an import takes 10)` : ""}. Pick one to review, or save every one that fits.</p>
              <ul className="skill-review-list" role="list">
                {drafts.map((item, index) => (
                  <li key={item.key}>
                    <button type="button" className={cx("chip skill-review-chip", index === active && "active")} aria-pressed={index === active} onClick={() => { setActive(index); setView("edit"); }}>
                      {item.saved ? <Check size={12} aria-hidden="true" /> : null}
                      <span className="truncate">{item.name || "Untitled"}</span>
                      {!fits(item) && !item.saved && <span className="skill-review-flag">too long</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card skill-review-card">
            <div className="skill-review-meta">
              {draft.source && <span className="chip mono truncate" title={draft.source}>{draft.source}</span>}
              {draft.version && <span className="chip mono">v{draft.version}</span>}
            </div>
            <label className="field">
              <span className="field-label" id="skill-review-name-label">Name</span>
              <input className="input" aria-labelledby="skill-review-name-label" maxLength={SAVED_SKILL_LIMITS.name} value={draft.name} onChange={event => patch(draft.key, { name: event.target.value })} />
            </label>
            <div className="field">
              <div className="skill-review-bar">
                <span className="field-label" id="skill-review-body-label">Procedure</span>
                <RadioGroup.Root className="segmented" aria-label="Procedure view" value={view} onValueChange={value => setView(value as "edit" | "preview")} orientation="horizontal" loop>
                  <RadioGroup.Item value="edit">Edit</RadioGroup.Item>
                  <RadioGroup.Item value="preview">Preview</RadioGroup.Item>
                </RadioGroup.Root>
              </div>
              {view === "edit"
                ? <textarea className="textarea skill-review-body" aria-labelledby="skill-review-body-label" rows={12} value={draft.body} onChange={event => patch(draft.key, { body: event.target.value })} />
                : <div className="skill-review-preview" aria-labelledby="skill-review-body-label"><Markdown text={draft.body} /></div>}
              <span className={cx("field-hint", over > 0 && "over")} aria-live="polite">
                {count(draft.body.trim().length)} / {count(SAVED_SKILL_LIMITS.body)} characters{over > 0 ? ` · ${count(over)} over: shorten it to save` : ""}
              </span>
            </div>
            {draft.error && <p className="field-error" role="alert">{draft.error}</p>}
            {full && !draft.saved && <p className="field-hint">You have {SAVED_SKILL_LIMITS.maxPerAccount} skills, the most an account keeps. Delete one to save another.</p>}
            <div className="saved-skill-form-actions">
              <Button variant="primary" icon={draft.saved ? Check : undefined} busy={saving} aria-disabled={Boolean(draft.saved) || !fits(draft) || full || undefined} onClick={() => void save([draft])}>
                {draft.saved ? "Saved to My Skills" : "Save to My Skills"}
              </Button>
              {savable.length > 1 && <Button busy={saving} aria-disabled={full || undefined} onClick={() => void save(savable)}>Save all {savable.length} that fit</Button>}
            </div>
          </div>
        </section>
      )}
    </Dialog>
  );
}
