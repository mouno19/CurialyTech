import { memo, useId, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Check, ChevronDown, CircleSlash, CircleX, ClipboardCheck, Compass, Hammer } from "lucide-react";
import { getModel, TEAM_ROLES, type TeamRole } from "@shared/agent";
import { Markdown } from "@/components/Markdown";
import { Spinner } from "@/components/common/Spinner";
import type { ItemOf, TeamMemberState, TeamMemberStatus } from "@/lib/taskStream";

export const ROLE_ICON: Record<TeamRole, LucideIcon> = { architect: Compass, engineer: Hammer, reviewer: ClipboardCheck };
const roleLabel = (role: TeamRole | "user") => (role === "user" ? "You" : TEAM_ROLES.find(item => item.id === role)?.label ?? role);

export function RoleBadge({ role }: { role: TeamRole | "user" }) {
  const Icon = role === "user" ? null : ROLE_ICON[role];
  return (
    <span className="role-badge" data-role={role}>
      {Icon && <Icon size={11} aria-hidden="true" />}
      {roleLabel(role)}
    </span>
  );
}

const STATUS_TEXT: Record<TeamMemberStatus, string> = { waiting: "Waiting", working: "Working", done: "Done", failed: "Failed", stopped: "Stopped" };

/** Live status of the three Dev Team members. `live`: the run is executing (a working member may pulse). */
export function TeamPanel({ team, live }: { team: Partial<Record<TeamRole, TeamMemberState>>; live: boolean }) {
  return (
    <ul className="team-panel" aria-label="Dev Team">
      {TEAM_ROLES.map(role => {
        const member = team[role.id];
        const Icon = ROLE_ICON[role.id];
        // A member can only be working while the run is; anything else is a log that stopped short.
        const status: TeamMemberStatus = member?.status === "working" && !live ? "stopped" : member?.status ?? "waiting";
        return (
          <li key={role.id} className="team-card" data-role={role.id} data-status={status}>
            <div className="team-card-head">
              <span className="team-avatar" aria-hidden="true"><Icon size={14} /></span>
              <span className="team-name">{role.label}</span>
              <span className="team-status">
                {status === "working" ? <Spinner size={11} /> : status === "done" ? <Check size={12} aria-hidden="true" /> : status === "failed" ? <CircleX size={12} aria-hidden="true" /> : status === "stopped" ? <CircleSlash size={12} aria-hidden="true" /> : null}
                {STATUS_TEXT[status]}
              </span>
            </div>
            <div className="team-model">{member ? getModel(member.model)?.label ?? member.model : role.title}</div>
            <div className="team-activity" title={member?.activity}>{member?.activity || "Waiting for its turn"}</div>
          </li>
        );
      })}
    </ul>
  );
}

function handoffTone(item: ItemOf<"handoff">) {
  if (item.handoff === "review") return /^approved/i.test(item.title) ? "approve" : "changes";
  return item.handoff;
}

/** A plan, review or report handed from one member to another. */
export const HandoffCard = memo(function HandoffCard({ item, defaultOpen = false }: { item: ItemOf<"handoff">; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className="handoff" data-kind={handoffTone(item)}>
      <button type="button" className="handoff-head" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={bodyId}>
        <RoleBadge role={item.from} />
        <ArrowRight size={12} className="faint" aria-hidden="true" />
        <RoleBadge role={item.to} />
        <span className="handoff-title clamp-2" title={item.title}>{item.title}</span>
        <ChevronDown size={14} className="handoff-chevron" aria-hidden="true" />
      </button>
      <div id={bodyId} className="handoff-body" hidden={!open}>
        {open && <Markdown text={item.content} />}
      </div>
    </div>
  );
});
