import { useEffect, useId, useState } from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { Globe, Lock, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/common/Button";
import { Dialog } from "@/components/common/Dialog";
import { StateNotice } from "@/components/common/StateNotice";
import { agentApi, ApiError, errorMessage, formatBytes, type ExportPlan, type ExportRequest, type ExportResult } from "@/lib/api";
import { plural } from "./format";

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const EXCLUDED_SHOWN = 8;

type Plan = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; plan: ExportPlan };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  onExported: (result: ExportResult) => void;
};

/**
 * Export or push to GitHub, with the exact effect named before anything is sent. New repositories
 * are private unless the user picks Public and confirms it; a linked repository gets a branch
 * (curialy/<id8> by default) and its default branch needs an explicit confirmation; re-exporting
 * over commits that weren't pushed from here needs its own. Closing the dialog sends nothing.
 */
export function ExportDialog({ open, onOpenChange, taskId, onExported }: Props) {
  const [plan, setPlan] = useState<Plan>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [confirmPublic, setConfirmPublic] = useState(false);
  const [branch, setBranch] = useState(`curialy/${taskId.slice(0, 8)}`);
  const [confirmDefault, setConfirmDefault] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const ids = { name: useId(), nameHint: useId(), nameError: useId(), branch: useId(), branchHint: useId(), publicBox: useId(), defaultBox: useId(), overwriteBox: useId(), visibility: useId() };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPlan({ phase: "loading" });
    setError(null);
    setTouched(false);
    setVisibility("private");
    setConfirmPublic(false);
    setConfirmDefault(false);
    setConfirmOverwrite(false);
    setBranch(`curialy/${taskId.slice(0, 8)}`);
    agentApi.exportPlan(taskId).then(
      next => {
        if (cancelled) return;
        setPlan({ phase: "ready", plan: next });
        if (next.target.kind === "new") setName(next.target.suggestedName);
      },
      failure => !cancelled && setPlan({ phase: "error", message: errorMessage(failure, "Couldn't prepare the export.") }),
    );
    return () => {
      cancelled = true;
    };
  }, [open, taskId, attempt]);

  const target = plan.phase === "ready" ? plan.plan.target : null;
  const trimmedName = name.trim();
  const nameError = target?.kind === "new" && (touched || trimmedName.length > 0) && !REPO_NAME.test(trimmedName)
    ? trimmedName ? "Use 1 to 100 letters, digits, \".\", \"-\" or \"_\"." : "Name the new repository."
    : null;
  const trimmedBranch = branch.trim();
  const toDefault = target?.kind === "linked" && trimmedBranch === target.defaultBranch;
  const overwrites = target?.kind === "existing" && target.remote !== "ours";
  const replaced = target?.kind === "existing" ? target.branch ?? "the default branch" : "";

  let primary = "Export";
  let ready = false;
  if (target?.kind === "new") {
    primary = visibility === "public" ? "Create public repository and push" : "Create private repository and push";
    ready = REPO_NAME.test(trimmedName) && (visibility === "private" || confirmPublic);
  } else if (target?.kind === "existing") {
    primary = `Push to ${target.repo}`;
    ready = !overwrites || confirmOverwrite;
  } else if (target?.kind === "linked") {
    primary = trimmedBranch ? `Push to ${trimmedBranch}` : "Push";
    ready = trimmedBranch.length > 0 && (!toDefault || confirmDefault);
  }

  const send = async () => {
    if (!target || !ready || sending) return setTouched(true);
    const body: ExportRequest =
      target.kind === "new" ? { repoName: trimmedName, visibility, ...(visibility === "public" ? { confirmPublic: true as const } : {}) }
        : target.kind === "linked" ? { branch: trimmedBranch, ...(toDefault ? { confirmDefaultBranch: true as const } : {}) }
          : overwrites ? { confirmOverwrite: true as const } : {};
    setSending(true);
    setError(null);
    try {
      const result = await agentApi.exportToGithub(taskId, body);
      onExported(result);
      onOpenChange(false);
      if (result.nothingToPush) toast("Nothing to push: the repository already matches the workspace.");
      else {
        toast.success(result.created ? `Created ${result.repo} and pushed ${plural(result.files, "file")}` : `Pushed ${plural(result.files, "file")} to ${result.repo}${result.branch ? ` (${result.branch})` : ""}`, {
          action: { label: "Open on GitHub", onClick: () => window.open(result.commitUrl || result.url, "_blank", "noopener,noreferrer") },
        });
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "confirm_public") setConfirmPublic(false);
      if (failure instanceof ApiError && failure.code === "confirm_default_branch") setConfirmDefault(false);
      // Someone pushed to the branch since the dialog opened: show the overwrite confirmation.
      if (failure instanceof ApiError && failure.code === "remote_changed" && plan.phase === "ready" && plan.plan.target.kind === "existing") {
        setPlan({ phase: "ready", plan: { ...plan.plan, target: { ...plan.plan.target, remote: "changed" } } });
        setConfirmOverwrite(false);
      }
      setError(errorMessage(failure, "The export failed."));
    } finally {
      setSending(false);
    }
  };

  const owner = target?.kind === "new" ? target.owner ?? (plan.phase === "ready" ? plan.plan.login : null) : null;
  const description = target?.kind === "new"
    ? `Creates a new repository in ${owner ? `${owner}'s` : "your"} GitHub account and pushes the workspace files.`
    : target?.kind === "existing" ? `Replaces the files on ${replaced} with the workspace files, as a new commit.`
      : target?.kind === "linked" ? `Commits the workspace changes and pushes them to a branch of ${target.repo}.`
        : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={next => !sending && onOpenChange(next)}
      title={target?.kind === "linked" || target?.kind === "existing" ? "Push to GitHub" : "Export to GitHub"}
      description={description}
      size="md"
      dismissible={!sending}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} aria-disabled={sending || undefined}>Cancel</Button>
          <Button variant="primary" busy={sending} aria-disabled={!ready || undefined} onClick={() => void send()}>{sending ? "Pushing…" : primary}</Button>
        </>
      }
    >
      {plan.phase === "loading" && <StateNotice variant="loading" size="sm" title="Checking what would be exported…" />}
      {plan.phase === "error" && (
        <StateNotice variant="error" size="sm" title="Couldn't prepare the export" actions={<Button size="sm" icon={RefreshCw} onClick={() => setAttempt(value => value + 1)}>Try again</Button>}>
          {plan.message}
        </StateNotice>
      )}
      {plan.phase === "ready" && target?.kind === "new" && (
        <>
          <div className="field">
            <label className="field-label" htmlFor={ids.name}>Repository name</label>
            <div className="export-name">
              {owner && <span className="export-owner mono" aria-hidden="true">{owner}/</span>}
              <input
                id={ids.name}
                className="input mono"
                value={name}
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? ids.nameError : ids.nameHint}
                onChange={event => setName(event.target.value)}
                onBlur={() => setTouched(true)}
                onKeyDown={event => event.key === "Enter" && void send()}
              />
            </div>
            {nameError ? <p id={ids.nameError} className="field-error" role="alert"><TriangleAlert size={14} aria-hidden="true" />{nameError}</p> : <p id={ids.nameHint} className="field-hint">{owner ? `Creates ${owner}/${trimmedName || "…"}. ` : ""}Letters, digits, ".", "-" and "_".</p>}
          </div>
          <fieldset className="field export-visibility">
            <legend id={ids.visibility} className="field-label">Visibility</legend>
            <RadioGroup.Root className="choice-group" value={visibility} onValueChange={value => { setVisibility(value as "private" | "public"); setConfirmPublic(false); }} aria-labelledby={ids.visibility}>
              <label className="choice">
                <RadioGroup.Item value="private" className="choice-radio"><RadioGroup.Indicator className="choice-dot" /></RadioGroup.Item>
                <span className="choice-body"><span className="choice-title"><Lock size={14} aria-hidden="true" /> Private</span><span className="choice-hint">Only you and people you invite can see it.</span></span>
              </label>
              <label className="choice">
                <RadioGroup.Item value="public" className="choice-radio"><RadioGroup.Indicator className="choice-dot" /></RadioGroup.Item>
                <span className="choice-body"><span className="choice-title"><Globe size={14} aria-hidden="true" /> Public</span><span className="choice-hint">Anyone on the internet can see the code.</span></span>
              </label>
            </RadioGroup.Root>
          </fieldset>
          {visibility === "public" && (
            <div className="notice" data-tone="warning">
              <TriangleAlert size={15} aria-hidden="true" />
              <div className="notice-body">
                <strong className="notice-title">The code will be public</strong>
                <label className="check-row" htmlFor={ids.publicBox}>
                  <input id={ids.publicBox} type="checkbox" checked={confirmPublic} onChange={event => setConfirmPublic(event.target.checked)} />
                  <span>I understand the code will be publicly visible</span>
                </label>
              </div>
            </div>
          )}
          <ExportContents plan={plan.plan} />
        </>
      )}
      {plan.phase === "ready" && target?.kind === "existing" && (
        <>
          <p>
            Push {plan.plan.files !== undefined ? plural(plan.plan.files, "file") : "the workspace files"} to <strong className="mono break-anywhere">{target.repo}</strong>
            {target.branch && <> on <code>{target.branch}</code></>}. Files that aren't in the workspace are removed from the branch; earlier versions stay in its history.
          </p>
          {overwrites && (
            <div className="notice" data-tone="warning">
              <TriangleAlert size={15} aria-hidden="true" />
              <div className="notice-body">
                <strong className="notice-title">{target.remote === "changed" ? `${replaced} has commits that weren't pushed from here` : `Couldn't confirm ${replaced} is unchanged`}</strong>
                <p>{target.remote === "changed" ? "Pushing replaces their files with the workspace files." : "If anyone else pushed to it since the last export, their files are replaced with the workspace files."} The commits stay in the branch history.</p>
                <label className="check-row" htmlFor={ids.overwriteBox}>
                  <input id={ids.overwriteBox} type="checkbox" checked={confirmOverwrite} onChange={event => setConfirmOverwrite(event.target.checked)} />
                  <span>Replace the files on {replaced}</span>
                </label>
              </div>
            </div>
          )}
          <ExportContents plan={plan.plan} />
        </>
      )}
      {plan.phase === "ready" && target?.kind === "linked" && (
        <>
          <div className="field">
            <label className="field-label" htmlFor={ids.branch}>Branch</label>
            <input
              id={ids.branch}
              className="input mono"
              value={branch}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={ids.branchHint}
              onChange={event => {
                setBranch(event.target.value);
                setConfirmDefault(false);
              }}
            />
            <p id={ids.branchHint} className="field-hint">A new branch keeps <code>{target.defaultBranch}</code> untouched; open a pull request from it on GitHub.</p>
          </div>
          {toDefault && (
            <div className="notice" data-tone="warning">
              <TriangleAlert size={15} aria-hidden="true" />
              <div className="notice-body">
                <strong className="notice-title">{target.defaultBranch} is the repository's default branch</strong>
                <label className="check-row" htmlFor={ids.defaultBox}>
                  <input id={ids.defaultBox} type="checkbox" checked={confirmDefault} onChange={event => setConfirmDefault(event.target.checked)} />
                  <span>Push directly to {target.defaultBranch}</span>
                </label>
              </div>
            </div>
          )}
        </>
      )}
      {error && <p className="notice" data-tone="danger" role="alert"><TriangleAlert size={15} aria-hidden="true" /><span className="notice-body">{error}</span></p>}
    </Dialog>
  );
}

function ExportContents({ plan }: { plan: ExportPlan }) {
  const excluded = plan.excluded ?? [];
  return (
    <div className="export-contents">
      {plan.files !== undefined && <p>{plural(plan.files, "file")}{plan.bytes ? ` · ${formatBytes(plan.bytes)}` : ""} will be pushed.</p>}
      {excluded.length > 0 && (
        <div className="export-excluded">
          <p className="micro">Left out (uploads and local secrets)</p>
          <ul>
            {excluded.slice(0, EXCLUDED_SHOWN).map(path => <li key={path} className="mono">{path}</li>)}
            {excluded.length > EXCLUDED_SHOWN && <li>and {excluded.length - EXCLUDED_SHOWN} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
