import { BarChart3, Brain, Code2, FileText, PenLine, Search, type LucideIcon } from "lucide-react";
import { SKILLS } from "@shared/skills";
import { AppShell } from "@/components/shell/AppShell";

const ICONS: Record<string, LucideIcon> = { search: Search, code: Code2, brain: Brain, chart: BarChart3, pen: PenLine, file: FileText };

// How each registry skill maps onto what the agent runtime actually provides today.
const RUNTIME: Record<string, { status: "live" | "partial"; how: string }> = {
  "web-research": { status: "live", how: "Web toggle: web_fetch from the sandbox + delegate_research to Manus." },
  coding: { status: "live", how: "Agent mode: file tools, run_command, harness verification and self-healing." },
  "deep-thinking": { status: "live", how: "Adaptive thinking on Opus 5.5 / Opus 5 with low · medium · high effort." },
  "data-analysis": { status: "partial", how: "Agent mode with Python 3 in the sandbox (install pandas per task)." },
  writing: { status: "live", how: "Chat mode on any model." },
  "document-analysis": { status: "partial", how: "Attach text files; they are copied into the task workspace. PDF/DOCX need a parser installed by the agent." },
};

export default function Skills() {
  return (
    <AppShell title="Skill Store">
      <div className="page">
        <div className="page-narrow">
          <p className="page-sub">Capabilities available to tasks, and the runtime mechanism behind each one.</p>
          <div className="grid grid-3">
            {SKILLS.map(skill => {
              const Icon = ICONS[skill.icon] ?? Code2;
              const runtime = RUNTIME[skill.id];
              return (
                <div key={skill.id} className="card card-pad">
                  <div className="row" style={{ marginBottom: 10 }}>
                    <Icon size={18} color={skill.accent === "mint" ? "var(--mint)" : "var(--violet)"} />
                    <strong style={{ fontSize: 14 }}>{skill.name}</strong>
                    <span className="spacer" />
                    <span className="chip mono">v{skill.version}</span>
                  </div>
                  <p className="muted" style={{ margin: "0 0 12px", fontSize: 12.5 }}>{skill.description}</p>
                  {runtime && <div className="row" style={{ alignItems: "flex-start", fontSize: 12 }}><span className={`chip ${runtime.status === "live" ? "mint" : "amber"}`}>{runtime.status}</span><span className="muted">{runtime.how}</span></div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
