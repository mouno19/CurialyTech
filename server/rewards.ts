import { normalizeXHandle, parseXPostId, type CreditSettings, type RewardsState } from "@shared/credits";
import { activeBoost, CreditError, getBalance, getSettings } from "./credits";
import { query } from "./db/pg";

// Credits earned on X. An account links one X account (by username; one X account per Curialy
// account), then claims each reward once: following the operator's account (found in that account's
// followers, or the user's own following list), and a post of its own that names the site (fetched by
// id; a post pays one account). Both claimed: the launch boost's refilling allowance applies while
// the offer lasts (credits.ts activeBoost). Checks go to the X API with the app's bearer token
// (X_BEARER_TOKEN, app-only: user and post lookups, followers and following), never logged.

const API = "https://api.x.com/2";
const SITE_URL = (process.env.PUBLIC_BASE_URL || "https://curialy.tech").replace(/\/+$/, "");
/** What a post must name to count: the site's host (in its text or a link it carries). */
const SITE_PATTERN = /curialy\.tech/i;
/** Followers of the target checked before the user's own following list is tried, and pages of that. */
const FOLLOWER_PAGES = 10;
const FOLLOWING_PAGES = 5;
const PAGE = 1000;

export const xConfigured = () => Boolean(process.env.X_BEARER_TOKEN);

type XUser = { id: string; username: string; name?: string };
type XPost = {
  id: string; text: string; author_id?: string; created_at?: string;
  entities?: { urls?: { expanded_url?: string; unwound_url?: string; display_url?: string; url?: string }[] };
  note_tweet?: { text?: string; entities?: XPost["entities"] };
  referenced_tweets?: { type: string; id: string }[];
};
type XResponse<T> = { data?: T; includes?: { users?: XUser[] }; meta?: { next_token?: string; result_count?: number }; errors?: { title?: string; detail?: string }[] };

const unavailable = (message = "Checking with X isn't possible right now. Try again in a few minutes.") => new CreditError(message, "unavailable", 503);

/** One call to the X API. Rate limits and X's own outages are temporary; a refused key is logged (without the key) and reads as unavailable. */
async function xGet<T>(path: string, params: Record<string, string | undefined> = {}): Promise<XResponse<T>> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw unavailable("Rewards aren't available on this server.");
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, value);
  const url = `${API}${path}${search.size ? `?${search}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}`, "user-agent": "curialy-rewards/1" }, signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    console.error("[rewards] X request failed:", error instanceof Error ? error.message : error);
    throw unavailable();
  }
  if (response.status === 429) throw new CreditError("X is rate limiting checks right now. Try again in a few minutes.", "busy", 503);
  if (response.status === 401 || response.status === 403) {
    console.error(`[rewards] X refused the request (${response.status}) for ${path}: check X_BEARER_TOKEN and the app's access level`);
    throw unavailable();
  }
  if (!response.ok && response.status !== 404) {
    console.error(`[rewards] X answered ${response.status} for ${path}`);
    throw unavailable();
  }
  try {
    return (await response.json()) as XResponse<T>;
  } catch {
    throw unavailable();
  }
}

/** Both a 404 and a 200 whose body only has `errors` mean "no such thing" on the X API. */
const notFound = (body: XResponse<unknown>) => body.data === undefined;

export async function lookupXUser(username: string): Promise<XUser | null> {
  const body = await xGet<XUser>(`/users/by/username/${encodeURIComponent(username)}`);
  return notFound(body) || !body.data ? null : { id: body.data.id, username: body.data.username, name: body.data.name };
}

// The account to follow, looked up once an hour (its id never changes; its name may).
let target: { handle: string; at: number; user: XUser | null } | null = null;
async function targetUser(handle: string): Promise<XUser> {
  if (!target || target.handle.toLowerCase() !== handle.toLowerCase() || Date.now() - target.at > 3_600_000 || !target.user) {
    const user = await lookupXUser(handle);
    target = { handle, at: Date.now(), user };
  }
  if (!target.user) {
    console.error(`[rewards] the X account to follow (@${handle}) was not found`);
    throw unavailable();
  }
  return target.user;
}

/** Whether `userId` follows `targetId`: the target's followers are read first (a short list), then the user's own following. */
export async function isFollowing(userId: string, targetId: string): Promise<boolean> {
  const scan = async (path: string, wanted: string, pages: number) => {
    let token: string | undefined;
    for (let page = 0; page < pages; page++) {
      const body = await xGet<XUser[]>(path, { max_results: String(PAGE), "user.fields": "id", pagination_token: token });
      if (body.data?.some(user => user.id === wanted)) return true;
      token = body.meta?.next_token;
      if (!token) return false;
    }
    // Pages left unread: not known either way.
    return null;
  };
  const viaFollowers = await scan(`/users/${targetId}/followers`, userId, FOLLOWER_PAGES);
  if (viaFollowers !== null) return viaFollowers;
  return (await scan(`/users/${userId}/following`, targetId, FOLLOWING_PAGES)) === true;
}

export async function fetchXPost(id: string): Promise<{ post: XPost; author: XUser | null } | null> {
  const body = await xGet<XPost>(`/tweets/${id}`, {
    "tweet.fields": "author_id,created_at,entities,note_tweet,referenced_tweets,text", expansions: "author_id", "user.fields": "username",
  });
  if (notFound(body) || !body.data) return null;
  return { post: body.data, author: body.includes?.users?.find(user => user.id === body.data!.author_id) ?? null };
}

/** The post names the site: in its text (long posts keep it in note_tweet) or in a link it carries. */
export function postNamesSite(post: Pick<XPost, "text" | "entities" | "note_tweet">): boolean {
  const texts = [post.text, post.note_tweet?.text];
  const links = [...(post.entities?.urls ?? []), ...(post.note_tweet?.entities?.urls ?? [])].flatMap(link => [link.expanded_url, link.unwound_url, link.display_url]);
  return [...texts, ...links].some(value => typeof value === "string" && SITE_PATTERN.test(value));
}

/** A repost of someone else's post is not the account's own post; quotes and replies are. */
export const isRepost = (post: Pick<XPost, "referenced_tweets">) => Boolean(post.referenced_tweets?.some(ref => ref.type === "retweeted"));

export function suggestedPost(handle: string) {
  return `Trying out Curialy: an autonomous coding agent that plans, writes and tests in its own sandbox while you watch every step. Free credits to start, and more for following @${handle}. ${SITE_URL}`;
}

// ---- The account's state ----

type XRow = { x_user_id: string | null; x_username: string | null; x_linked_at: Date | null; x_followed_at: Date | null; x_posted_at: Date | null; x_post_id: string | null; free_allowance_withheld: boolean };
const X_COLUMNS = "x_user_id, x_username, x_linked_at, x_followed_at, x_posted_at, x_post_id, free_allowance_withheld";

async function xRow(userId: string): Promise<XRow> {
  const { rows } = await query<XRow>(`SELECT ${X_COLUMNS} FROM curialy.users WHERE id = $1`, [userId]);
  if (!rows[0]) throw new CreditError("Account not found.", "invalid_code", 404);
  return rows[0];
}

/** Accounts that started without the free credits don't get the X rewards either (the same rule as a promo code for anyone). */
function assertEligible(row: XRow) {
  if (row.free_allowance_withheld) throw new CreditError("The free rewards aren't available on this account.", "locked", 403);
}

export function rewardsStateOf(row: XRow, settings: CreditSettings, now = Date.now()): RewardsState {
  const { rewards } = settings;
  const offered = rewards.boost.enabled && rewards.boost.creditsPerWindow > 0 && (!rewards.boost.endsAt || Date.parse(rewards.boost.endsAt) > now);
  return {
    available: xConfigured(),
    followHandle: rewards.followHandle,
    siteUrl: SITE_URL,
    welcomeCredits: settings.welcomeCredits,
    x: row.x_user_id && row.x_username ? { username: row.x_username, linkedAt: (row.x_linked_at ?? new Date(0)).toISOString(), locked: Boolean(row.x_followed_at || row.x_posted_at) } : null,
    follow: { credits: rewards.followCredits, claimedAt: row.x_followed_at?.toISOString() ?? null },
    post: { credits: rewards.postCredits, claimedAt: row.x_posted_at?.toISOString() ?? null, postUrl: row.x_post_id && row.x_username ? `https://x.com/${row.x_username}/status/${row.x_post_id}` : null },
    boost: { offered, active: activeBoost(row, settings, now) !== null, creditsPerWindow: rewards.boost.creditsPerWindow, windowHours: rewards.boost.windowHours, endsAt: rewards.boost.endsAt },
    suggestedPost: suggestedPost(rewards.followHandle),
  };
}

export async function rewardsState(userId: string): Promise<RewardsState> {
  const [row, settings] = await Promise.all([xRow(userId), getSettings()]);
  return rewardsStateOf(row, settings);
}

// ---- Linking ----

/** Link an X account by username (looked up on X). Another account's X account is refused; a linked one that earned a reward can't be changed. */
export async function linkX(userId: string, input: string): Promise<RewardsState> {
  const username = normalizeXHandle(input);
  if (!username) throw new CreditError("Enter your X username (letters, digits and underscores, up to 15).", "invalid_code", 400);
  const current = await xRow(userId);
  assertEligible(current);
  if (current.x_followed_at || current.x_posted_at) throw new CreditError(`This account already earned credits with @${current.x_username}, so its X account can't be changed.`, "locked", 409);
  const settings = await getSettings();
  if (username.toLowerCase() === settings.rewards.followHandle.toLowerCase()) throw new CreditError("That's the account to follow, not yours.", "invalid_code", 400);
  const user = await lookupXUser(username);
  if (!user) throw new CreditError(`No X account is named @${username}.`, "invalid_code", 404);
  try {
    await query("UPDATE curialy.users SET x_user_id = $2, x_username = $3, x_linked_at = now() WHERE id = $1", [userId, user.id, user.username]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new CreditError(`@${user.username} is already linked to another Curialy account.`, "x_taken", 409);
    throw error;
  }
  return rewardsState(userId);
}

/** Forget the linked X account, as long as nothing was earned with it. */
export async function unlinkX(userId: string): Promise<RewardsState> {
  const { rowCount } = await query("UPDATE curialy.users SET x_user_id = NULL, x_username = NULL, x_linked_at = NULL WHERE id = $1 AND x_followed_at IS NULL AND x_posted_at IS NULL", [userId]);
  if (!rowCount) {
    const current = await xRow(userId);
    if (current.x_followed_at || current.x_posted_at) throw new CreditError("This account earned credits with its X account, so it stays linked.", "locked", 409);
  }
  return rewardsState(userId);
}

/** Admin: forget everything X about an account (link, claims, post), ending its boost. Credits already given stay (remove them with a grant). */
export async function resetXRewards(userId: string, by: string) {
  const { rowCount } = await query("UPDATE curialy.users SET x_user_id = NULL, x_username = NULL, x_linked_at = NULL, x_followed_at = NULL, x_posted_at = NULL, x_post_id = NULL WHERE id = $1", [userId]);
  if (!rowCount) throw new CreditError("Account not found.", "invalid_code", 404);
  await query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail, created_by) VALUES ($1, 'adjust', 0, 'X rewards reset', $2)", [userId, by]);
}

// ---- Claims ----

/** The follow reward: the linked X account is found following the operator's. Once. */
export async function claimFollow(userId: string) {
  const [row, settings] = await Promise.all([xRow(userId), getSettings()]);
  assertEligible(row);
  if (!row.x_user_id) throw new CreditError("Link your X account first.", "not_linked", 409);
  if (row.x_followed_at) throw new CreditError("This reward was already claimed.", "already_claimed", 409);
  const handle = settings.rewards.followHandle;
  const following = await isFollowing(row.x_user_id, (await targetUser(handle)).id);
  if (!following) throw new CreditError(`@${row.x_username} doesn't follow @${handle} yet. Follow, then check again (a new follow can take a minute to show).`, "not_following", 409);
  const credits = settings.rewards.followCredits;
  // Conditional: two checks at once pay once.
  const { rowCount } = await query("UPDATE curialy.users SET x_followed_at = now(), bonus_credits = bonus_credits + $2 WHERE id = $1 AND x_followed_at IS NULL", [userId, credits]);
  if (!rowCount) throw new CreditError("This reward was already claimed.", "already_claimed", 409);
  await query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail) VALUES ($1, 'reward', $2, $3)", [userId, credits, `followed @${handle} on X`]);
  return { credits, state: await rewardsState(userId), balance: await getBalance(userId) };
}

/** The post reward: a post by the linked X account that names the site. Once per account, and a post pays once. */
export async function claimPost(userId: string, input: string) {
  const postId = parseXPostId(input);
  if (!postId) throw new CreditError("Paste the address of your post (x.com/…/status/…).", "invalid_code", 400);
  const [row, settings] = await Promise.all([xRow(userId), getSettings()]);
  assertEligible(row);
  if (!row.x_user_id) throw new CreditError("Link your X account first.", "not_linked", 409);
  if (row.x_posted_at) throw new CreditError("This reward was already claimed.", "already_claimed", 409);
  const found = await fetchXPost(postId);
  if (!found) throw new CreditError("That post wasn't found on X. Check the address, and that the post is public.", "post_invalid", 404);
  if (found.post.author_id !== row.x_user_id) throw new CreditError(`That post isn't by @${row.x_username}, the X account linked here.`, "post_invalid", 409);
  if (isRepost(found.post)) throw new CreditError("A repost doesn't count: write a post of your own about Curialy.", "post_invalid", 409);
  if (!postNamesSite(found.post)) throw new CreditError(`The post has to mention ${SITE_URL.replace(/^https?:\/\//, "")}.`, "post_invalid", 409);
  const credits = settings.rewards.postCredits;
  let rowCount: number | null;
  try {
    ({ rowCount } = await query("UPDATE curialy.users SET x_posted_at = now(), x_post_id = $3, bonus_credits = bonus_credits + $2 WHERE id = $1 AND x_posted_at IS NULL", [userId, credits, postId]));
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new CreditError("That post was already used for a reward.", "post_invalid", 409);
    throw error;
  }
  if (!rowCount) throw new CreditError("This reward was already claimed.", "already_claimed", 409);
  await query("INSERT INTO curialy.credit_events (user_id, kind, amount, detail) VALUES ($1, 'reward', $2, $3)", [userId, credits, `posted about Curialy on X (post ${postId})`]);
  return { credits, state: await rewardsState(userId), balance: await getBalance(userId) };
}
