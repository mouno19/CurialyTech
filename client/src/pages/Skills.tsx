import type { LucideIcon } from "lucide-react";
import { BarChart3, Brain, Check, CircleDashed, Code2, FileText, PenLine, Search } from "lucide-react";
import { SKILLS } from "@shared/skills";
import { AppShell } from "@/components/shell/AppShell";

const ICONS: Record<string, LucideIcon> = { search: Search, code: Code2, brain: Brain, chart: BarChart3, pen: PenLine, file: FileText };

// How each registry skill maps onto what the agent runtime actually provides today.
const RUNTIME: Record<string, { status: "live" | "partial"; how: string }> = {
  "web-research": { status: "live", how: "Web toggle: page fetching from the sandbox, the Curialy Live Browser and the Research Agent." },
  coding: { status: "live", how: "Agent mode: file tools, run_command, harness verification and self-healing." },
  "deep-thinking": { status: "live", how: "Visible reasoning with a low · medium · high thinking level on models that support it." },
  "data-analysis": { status: "live", how: "CSV, TSV, JSON and Excel tables are summarized on attach: column types, missing values, and the range and average of each number. analyze_data does the same for any table already in the workspace." },
  writing: { status: "live", how: "Chat mode on any model." },
  "document-analysis": { status: "live", how: "PDF, Word and PowerPoint files are read on attach when they have a text layer. A scan with no text is reported as unreadable. read_document returns the rest of a long file." },
};

const STATUS = {
  live: { label: "Available", tone: "success", icon: Check },
  partial: { label: "Partial", tone: "warning", icon: CircleDashed },
} as const;

export default function Skills() {
  const live = SKILLS.filter(skill => RUNTIME[skill.id]?.status === "live").length;
  return (
    <AppShell title="Skill Store">
      <div className="page">
        <div className="page-narrow">
          <header className="page-head">
            <div>
              <span className="eyebrow">Capabilities</span>
              <h2 className="page-title">Skill Store</h2>
              <p className="page-sub">What tasks can do, and the runtime mechanism behind each skill. {live === SKILLS.length ? `All ${SKILLS.length} are available.` : `${live} of ${SKILLS.length} are fully available; partial ones work with the limits noted.`}</p>
            </div>
          </header>
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
