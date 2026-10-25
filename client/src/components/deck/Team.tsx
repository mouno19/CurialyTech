import { useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Compass, Hammer, Loader2, XCircle } from "lucide-react";
import { getModel, TEAM_ROLES, type TeamRole } from "@shared/agent";
import { Markdown } from "@/components/Markdown";
import type { TeamMemberState, TimelineItem } from "@/lib/taskStream";

export const ROLE_ICON: Record<TeamRole, typeof Compass> = { architect: Compass, engineer: Hammer, reviewer: ClipboardCheck };
const label = (role: TeamRole | "user") => (role === "user" ? "You" : TEAM_ROLES.find(item => item.id === role)?.label ?? role);

export function RoleBadge({ role }: { role: TeamRole }) {
  const Icon = ROLE_ICON[role];
  return <span className={`role-badge ${role}`}><Icon size={11} /> {label(role)}</span>;
}

/** Live status of the three Dev Team members. */
export function TeamPanel({ team }: { team: Partial<Record<TeamRole, TeamMemberState>> }) {
  return (
    <div className="team-panel" role="list" aria-label="Dev Team">
      {TEAM_ROLES.map(role => {
        const member = team[role.id];
        const Icon = ROLE_ICON[role.id];
        const status = member?.status ?? "waiting";
        return (
          <div key={role.id} className={`team-card ${role.id} ${status}`} role="listitem">
            <div className="team-card-head">
              <span className="team-avatar"><Icon size={14} /></span>
              <span className="team-name">{role.label}</span>
              <span className={`team-status ${status}`}>
                {status === "working" ? <Loader2 size={11} className="spin" /> : status === "done" ? <CheckCircle2 size={11} /> : status === "failed" ? <XCircle size={11} /> : null}
                {status}
              </span>
            </div>
            <div className="team-model">{member ? getModel(member.model)?.label ?? member.model : role.title}</div>
            <div className="team-activity" title={member?.activity}>{member?.activity ?? "Waiting for its turn"}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A plan, review or report handed from one member to another. */
export function HandoffCard({ item, defaultOpen = false }: { item: Extract<TimelineItem, { kind: "handoff" }>; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = item.handoff === "review" ? (item.title.startsWith("Approved") ? "approve" : "changes") : item.handoff;
  return (
    <div className={`handoff ${tone}`}>
      <button type="button" className="handoff-head" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <RoleBadge role={item.from} />
        <ArrowRight size={12} className="faint" />
        {item.to === "user" ? <span className="role-badge user">You</span> : <RoleBadge role={item.to} />}
        <span className="handoff-title">{item.title}</span>
        <span className="spacer" />
        {open ? <ChevronDown size={14} className="faint" /> : <ChevronRight size={14} className="faint" />}
      </button>
      {open && <div className="handoff-body"><Markdown text={item.content} /></div>}
    </div>
  );
}
