import { useEffect, useState, type FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Brain, Check, CircleDashed, Code2, Download, FileText, PenLine, Search } from "lucide-react";
import { SAVED_SKILL_LIMITS, SKILLS } from "@shared/skills";
import { Button } from "@/components/common/Button";
import { AppShell } from "@/components/shell/AppShell";
import { ImportSkillDialog } from "@/components/skills/ImportSkillDialog";
import { agentApi, errorMessage } from "@/lib/api";
import { forgetSavedSkill, refreshSavedSkills, rememberSavedSkills, useSavedSkills } from "@/lib/savedSkills";

const ICONS: Record<string, LucideIcon> = { search: Search, code: Code2, brain: Brain, chart: BarChart3, pen: PenLine, file: FileText };

// How each registry skill maps onto what the agent runtime actually provides today.
const RUNTIME: Record<string, { status: "live" | "partial"; how: string }> = {
  "web-research": { status: "live", how: "Web toggle: page fetching from the sandbox, the Curialy Live Browser and the Research Agent." },
  coding: { status: "live", how: "Agent mode: file tools, run_command, harness verification and self-healing." },
  "deep-thinking": { status: "live", how: "Visible reasoning with a low · medium · high thinking level on models that support it." },
  "data-analysis": { status: "live", how: "CSV, TSV, JSON and Excel tables are summarized on attach: column types, missing values, and the range and average of each number. One bar chart is drawn from that numeric column. analyze_data does the same for any table already in the workspace." },
  writing: { status: "live", how: "Chat mode on any model." },
  "document-analysis": { status: "live", how: "PDF, Word and PowerPoint files are read on attach. A scan with no text layer is sent to a vision model as page images, and that reading is what the task sees. read_document returns the rest of a long file." },
};

const STATUS = {
  live: { label: "Available", tone: "success", icon: Check },
  partial: { label: "Partial", tone: "warning", icon: CircleDashed },
} as const;

export default function Skills() {
  const live = SKILLS.filter(skill => RUNTIME[skill.id]?.status === "live").length;
  // Shared with the composers' Skills menus: what is saved or imported here is listed there at once.
  const { skills, error: listError } = useSavedSkills();
  const loadError = skills ? null : listError;
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const atLimit = (skills?.length ?? 0) >= SAVED_SKILL_LIMITS.maxPerAccount && !editing;

  useEffect(() => { void refreshSavedSkills(); }, []);

  const reset = () => {
    setEditing(null);
    setName("");
    setBody("");
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || atLimit || !name.trim() || !body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const saved = editing ? await agentApi.updateSkill(editing, { name, body }) : await agentApi.saveSkill({ name, body });
      rememberSavedSkills(saved.skill);
      reset();
    } catch (failure) {
      setError(errorMessage(failure, "Couldn't save that skill."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await agentApi.deleteSkill(id);
      forgetSavedSkill(id);
      if (editing === id) reset();
      setConfirming(null);
    } catch (failure) {
      setError(errorMessage(failure, "Couldn't delete that skill."));
    }
  };

  return (
    <AppShell title="Skill Store">
      <div className="page">
        <div className="page-narrow">
          <header className="page-head">
            <div>
              <span className="eyebrow">Capabilities</span>
              <h2 className="page-title">Skill Store</h2>
              <p className="page-sub">Save a procedure once, or import one from a file, a GitHub or web link, or pasted text, and attach it to any task. Below that, the built-in capabilities and how each one runs. {live === SKILLS.length ? `All ${SKILLS.length} are available.` : `${live} of ${SKILLS.length} are fully available; partial ones work with the limits noted.`}</p>
            </div>
            <div className="page-head-actions">
              <Button variant="primary" icon={Download} onClick={() => setImporting(true)}>Import skill</Button>
            </div>
          </header>
          <ImportSkillDialog open={importing} onOpenChange={setImporting} room={SAVED_SKILL_LIMITS.maxPerAccount - (skills?.length ?? 0)} />

          <section className="saved-skills" aria-labelledby="your-skills">
            <div>
              <h3 className="skill-section-title" id="your-skills">Your skills</h3>
              <p className="saved-skills-copy">A procedure you write once: how this account runs tests, how a pull request should be described, which folders are off limits. Attach it from the composer to any task, including a repository that has no note yet.</p>
            </div>
            {loadError && <p className="field-error" role="alert">{loadError}</p>}
            <form className="card saved-skill-form" onSubmit={event => void submit(event)}>
              <label className="field">
                <span className="field-label" id="saved-skill-name-label">Name</span>
                <input id="saved-skill-name" className="input" aria-labelledby="saved-skill-name-label" value={name} maxLength={SAVED_SKILL_LIMITS.name} disabled={atLimit || saving} placeholder="How to run tests" onChange={event => setName(event.target.value)} />
              </label>
              <label className="field">
                <span className="field-label" id="saved-skill-body-label">Procedure</span>
                <textarea id="saved-skill-body" className="textarea" aria-labelledby="saved-skill-body-label" value={body} maxLength={SAVED_SKILL_LIMITS.body} disabled={atLimit || saving} rows={editing && body.length > 600 ? 14 : 5} placeholder="Run pnpm test. Describe a pull request by the change a reviewer can see. Leave server/billing alone." onChange={event => setBody(event.target.value)} />
                <span className="field-hint">{body.trim().length.toLocaleString("en-US")} / {SAVED_SKILL_LIMITS.body.toLocaleString("en-US")}</span>
              </label>
              {atLimit && <p className="field-hint">You can save {SAVED_SKILL_LIMITS.maxPerAccount} skills. Edit or delete one to add another.</p>}
              {error && <p className="field-error" role="alert">{error}</p>}
              <div className="saved-skill-form-actions">
                <Button type="submit" variant="primary" busy={saving} aria-disabled={atLimit || !name.trim() || !body.trim() || undefined}>{editing ? "Save changes" : "Save skill"}</Button>
                {editing && <Button variant="ghost" onClick={reset}>Cancel</Button>}
              </div>
            </form>
            {skills && skills.length === 0 && <p className="saved-skills-copy">None yet. Write one above, or import a SKILL.md. Once saved, it can be attached to the next task.</p>}
            {skills && skills.length > 0 && (
              <ul className="card saved-skill-list">
                {skills.map(skill => (
                  <li key={skill.id} className="saved-skill">
                    <h4 className="saved-skill-name">{skill.name}</h4>
                    <p className={`saved-skill-body${skill.body.length > 400 && !expanded.has(skill.id) ? " clamped" : ""}`}>{skill.body}</p>
                    <div className="saved-skill-actions">
                      {skill.body.length > 400 && (
                        <Button size="sm" variant="ghost" aria-expanded={expanded.has(skill.id)} onClick={() => setExpanded(current => { const next = new Set(current); if (!next.delete(skill.id)) next.add(skill.id); return next; })}>
                          {expanded.has(skill.id) ? "Show less" : `Show all (${skill.body.length.toLocaleString("en-US")} characters)`}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(skill.id); setName(skill.name); setBody(skill.body); setConfirming(null); setError(null); }}>Edit</Button>
                      {confirming === skill.id ? (
                        <>
                          <span className="field-hint">Delete this skill?</span>
                          <Button size="sm" variant="danger" onClick={() => void remove(skill.id)}>Delete</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(skill.id)}>Delete</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <h3 className="skill-section-title">Built-in</h3>
          <ul className="cols-3 skill-grid">
            {SKILLS.map(skill => {
              const Icon = ICONS[skill.icon] ?? Code2;
              const runtime = RUNTIME[skill.id];
              const status = runtime ? STATUS[runtime.status] : null;
              return (
                <li key={skill.id} className="card skill-card">
                  <div className="skill-head">
                    <span className="skill-icon" aria-hidden="true"><Icon size={17} /></span>
                    <h3 className="skill-name">{skill.name}</h3>
                    <span className="chip mono skill-version">v{skill.version}</span>
                  </div>
                  <p className="skill-desc">{skill.description}</p>
                  {runtime && status && (
                    <div className="skill-runtime">
                      <span className="status-badge" data-tone={status.tone} data-size="sm">
                        <status.icon size={12} aria-hidden="true" />
                        {status.label}
                      </span>
                      <p>{runtime.how}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
