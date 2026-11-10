import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Check, ExternalLink, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { RewardsState } from "@shared/credits";
import { accountApi, errorMessage } from "@/lib/api";
import { refreshAccount } from "@/lib/account";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import { creditCount, shortDayText } from "./format";
import { offerEnd } from "./plans";

// Earn credits on X, on the Plans & Billing page: link one X account, then claim following
// @handle and a post that names the site. The server checks both on X; this only asks and shows.

/** The X "post" and "follow" intents, opened in a new tab. */
const followUrl = (handle: string) => `https://x.com/intent/follow?screen_name=${encodeURIComponent(handle)}`;
const postUrl = (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;

export function EarnCredits({ onApiCredit }: { onApiCredit?: () => void }) {
  const [rewards, setRewards] = useState<RewardsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [posted, setPosted] = useState("");
  const [busy, setBusy] = useState<"link" | "unlink" | "follow" | "post" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const id = useId();

  const load = useCallback(() => {
    setError(null);
    accountApi.rewards().then(
      result => setRewards(result.rewards),
      loadError => setError(errorMessage(loadError, "Couldn't load the rewards.")),
    );
  }, []);
  useEffect(() => { load(); }, [load]);

  const fail = (actionError: unknown) => setFormError(errorMessage(actionError, "That didn't work. Try again."));
  const claimed = (credits: number, apiUsd: number, state: RewardsState) => {
    setRewards(state);
    setFormError(null);
    toast.success(apiUsd > 0 ? `${creditCount(credits)} credits added, and $${apiUsd} on your Developer API balance.` : `${creditCount(credits)} credits added.`);
    void refreshAccount();
    if (apiUsd > 0) onApiCredit?.();
  };

  const link = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !username.trim()) return;
    setBusy("link");
    setFormError(null);
    try {
      setRewards((await accountApi.linkX(username)).rewards);
      setUsername("");
    } catch (linkError) {
      fail(linkError);
    } finally {
      setBusy(null);
    }
  };
  const unlink = async () => {
    setBusy("unlink");
    setFormError(null);
    try {
      setRewards((await accountApi.unlinkX()).rewards);
    } catch (unlinkError) {
      fail(unlinkError);
    } finally {
      setBusy(null);
    }
  };
  const follow = async () => {
    setBusy("follow");
    setFormError(null);
    try {
      const result = await accountApi.claimFollow();
      claimed(result.credits, result.apiUsd, result.state);
    } catch (followError) {
      fail(followError);
    } finally {
      setBusy(null);
    }
  };
  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !posted.trim()) return;
    setBusy("post");
    setFormError(null);
    try {
      const result = await accountApi.claimPost(posted);
      claimed(result.credits, result.apiUsd, result.state);
      setPosted("");
    } catch (postError) {
      fail(postError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="rewards" className="card" tabIndex={-1} aria-labelledby="bill-rewards-title" aria-busy={!rewards && !error || undefined}>
      <div className="card-head"><h2 id="bill-rewards-title">Earn credits on X</h2></div>
      <div className="card-body earn">
        {rewards ? <Steps rewards={rewards} id={id} username={username} posted={posted} busy={busy} onUsername={setUsername} onPosted={setPosted} onLink={link} onUnlink={() => void unlink()} onFollow={() => void follow()} onPost={post} />
          : error ? <StateNotice variant="error" size="sm" title="Couldn't load the rewards" actions={<Button size="sm" icon={RotateCcw} onClick={load}>Try again</Button>}>{error}</StateNotice>
            : <span className="skeleton skeleton-block" aria-hidden="true" />}
        {formError && <p className="field-error" role="alert">{formError}</p>}
      </div>
    </section>
  );
}

function Steps({ rewards, id, username, posted, busy, onUsername, onPosted, onLink, onUnlink, onFollow, onPost }: {
  rewards: RewardsState;
  id: string;
  username: string;
  posted: string;
  busy: "link" | "unlink" | "follow" | "post" | null;
  onUsername: (value: string) => void;
  onPosted: (value: string) => void;
  onLink: (event: FormEvent) => void;
  onUnlink: () => void;
  onFollow: () => void;
  onPost: (event: FormEvent) => void;
}) {
  const linked = Boolean(rewards.x);
  const off = !rewards.available;
  return (
    <>
      {off && <p className="bill-note">Checking posts on X isn't set up right now, so these rewards can't be claimed yet.</p>}
      <ol className="earn-steps">
        <li className="earn-step">
          <h3 className="earn-step-title">Link your X account</h3>
          {rewards.x ? (
            <p className="earn-linked">
              <Check size={15} aria-hidden="true" /> Linked as <strong>@{rewards.x.username}</strong>
              {!rewards.x.locked && <Button size="sm" variant="ghost" busy={busy === "unlink"} disabled={busy !== null && busy !== "unlink"} onClick={onUnlink}>Use a different account</Button>}
            </p>
          ) : (
            <form className="earn-row" onSubmit={onLink} noValidate>
              <label className="sr-only" htmlFor={`${id}-x`}>Your X username</label>
              <input id={`${id}-x`} className="input" value={username} maxLength={100} autoComplete="off" spellCheck={false} placeholder="@yourname" disabled={off} onChange={event => onUsername(event.target.value)} />
              <Button type="submit" variant="primary" busy={busy === "link"} disabled={off || !username.trim()}>Link</Button>
            </form>
          )}
          {rewards.x?.locked && <p className="field-hint">It stays linked, because a reward was already claimed with it.</p>}
        </li>
        <li className="earn-step">
          <h3 className="earn-step-title">
            Follow @{rewards.followHandle}
            <span className="chip">{rewards.follow.claimedAt ? "Claimed" : `+${creditCount(rewards.follow.credits)} credits`}</span>
          </h3>
          {rewards.follow.claimedAt ? (
            <p className="earn-done"><Check size={15} aria-hidden="true" /> You're following @{rewards.followHandle}.</p>
          ) : (
            <div className="earn-row">
              <a className="btn sm" href={followUrl(rewards.followHandle)} target="_blank" rel="noopener noreferrer">Follow @{rewards.followHandle} <ExternalLink size={13} aria-hidden="true" /></a>
              <Button variant="primary" size="sm" busy={busy === "follow"} disabled={!linked || off || (busy !== null && busy !== "follow")} onClick={onFollow}>I've followed — check</Button>
            </div>
          )}
        </li>
        <li className="earn-step">
          <h3 className="earn-step-title">
            Post about Curialy
            <span className="chip">{rewards.post.claimedAt ? "Claimed" : `+${creditCount(rewards.post.credits)} credits`}</span>
          </h3>
          {rewards.post.claimedAt ? (
            <p className="earn-done">
              <Check size={15} aria-hidden="true" />
              {rewards.post.postUrl ? <a href={rewards.post.postUrl} target="_blank" rel="noopener noreferrer">Your post <ExternalLink size={13} aria-hidden="true" /></a> : "Your post was counted."}
            </p>
          ) : (
            <>
              <p className="earn-suggest">{rewards.suggestedPost}</p>
              <div className="earn-row">
                <a className="btn sm" href={postUrl(rewards.suggestedPost)} target="_blank" rel="noopener noreferrer">Post this <ExternalLink size={13} aria-hidden="true" /></a>
              </div>
              <form className="earn-row" onSubmit={onPost} noValidate>
                <label className="sr-only" htmlFor={`${id}-post`}>Address of your post</label>
                <input id={`${id}-post`} className="input" value={posted} maxLength={500} autoComplete="off" spellCheck={false} placeholder="https://x.com/you/status/…" disabled={!linked || off} onChange={event => onPosted(event.target.value)} />
                <Button type="submit" variant="primary" busy={busy === "post"} disabled={!linked || off || !posted.trim()}>Check my post</Button>
              </form>
              <p className="field-hint">The post has to be public, by the account you linked, and mention {rewards.siteUrl.replace(/^https?:\/\//, "")}. A repost doesn't count. Once per account.</p>
            </>
          )}
        </li>
      </ol>
      {rewards.api.usd > 0 && (
        <p className="bill-note">
          {rewards.api.grantedAt
            ? `$${rewards.api.usd} is on your Developer API balance for doing both.`
            : `Do both and $${rewards.api.usd} is added to your Developer API balance, once.`}
        </p>
      )}
      {rewards.boost.offered && (
        <p className="bill-note">
          {rewards.boost.active
            ? `Both done: this account gets ${creditCount(rewards.boost.creditsPerWindow)} credits every ${rewards.boost.windowHours} hours`
            : `Do both and this account also gets ${creditCount(rewards.boost.creditsPerWindow)} credits every ${rewards.boost.windowHours} hours`}
          {` while the offer lasts (${offerEnd(rewards.boost.endsAt, shortDayText)}). A plan's allowance is used instead when it's higher.`}
        </p>
      )}
    </>
  );
}
