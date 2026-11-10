import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseXPostId } from "@shared/credits";

// The X rewards: linking an account, and the two claims. The X API is a fake fetch; the database is
// the one row these tests keep.

const store = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  events: [] as unknown[][],
  failUnique: false,
  followers: [] as string[],
  /** Followers answers keep a next page, so the check falls through to the account's own following list. */
  moreFollowers: false,
  following: [] as string[],
  post: null as null | Record<string, unknown>,
}));

vi.mock("./db/pg", () => {
  const run = async (text: string, values: unknown[] = []) => {
    if (text.includes("app_settings") && text.includes("'billing'")) return { rows: [] };
    if (text.includes("app_settings")) return { rows: [] };
    if (text.startsWith("SELECT x_user_id") || text.startsWith("SELECT id, role, credit_allowance")) return { rows: store.user ? [store.user] : [] };
    if (text.startsWith("UPDATE curialy.users SET x_user_id = NULL")) {
      store.user = { ...store.user, x_user_id: null, x_username: null, x_linked_at: null };
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("UPDATE curialy.users SET x_user_id")) {
      if (store.failUnique) throw Object.assign(new Error("duplicate"), { code: "23505" });
      store.user = { ...store.user, x_user_id: values[1], x_username: values[2], x_linked_at: new Date() };
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("UPDATE curialy.users SET x_followed_at")) {
      if (store.user?.x_followed_at) return { rows: [], rowCount: 0 };
      store.user = { ...store.user, x_followed_at: new Date(), bonus_credits: String(Number(store.user?.bonus_credits ?? 0) + Number(values[1])) };
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("UPDATE curialy.users SET x_posted_at")) {
      if (store.failUnique) throw Object.assign(new Error("duplicate"), { code: "23505" });
      if (store.user?.x_posted_at) return { rows: [], rowCount: 0 };
      store.user = { ...store.user, x_posted_at: new Date(), x_post_id: values[2], bonus_credits: String(Number(store.user?.bonus_credits ?? 0) + Number(values[1])) };
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("INSERT INTO curialy.credit_events")) {
      store.events.push(values);
      return { rows: [] };
    }
    return { rows: [], rowCount: 0 };
  };
  return { query: vi.fn(run) };
});

const rewards = await import("./rewards");
const { resetCreditSettings } = await import("./credits");
const { resetBillingSettings } = await import("./billing/settings");

const row = (patch: Record<string, unknown> = {}) => ({
  id: "u1", role: "user", credit_allowance: null, bonus_credits: "0", window_started_at: null, window_used: "0", free_allowance_withheld: false,
  plan_id: null, plan_expires_at: null, plan_credits_per_window: null, x_user_id: null, x_username: null, x_linked_at: null, x_followed_at: null, x_posted_at: null, x_post_id: null, ...patch,
});

beforeEach(() => {
  store.user = row();
  store.events.length = 0;
  store.failUnique = false;
  store.followers = ["42"];
  store.moreFollowers = false;
  store.following = [];
  store.post = { id: "1847920000000000099", text: "I use Curialy", author_id: "42", entities: { urls: [{ expanded_url: "https://curialy.tech/welcome" }] } };
  resetCreditSettings();
  resetBillingSettings();
  vi.stubEnv("X_BEARER_TOKEN", "test-token");
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(String(input)).pathname;
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (path.endsWith("/users/by/username/Yumiko_web3")) return ok({ data: { id: "1646", username: "Yumiko_web3" } });
    if (path.endsWith("/users/by/username/ada")) return ok({ data: { id: "42", username: "Ada" } });
    if (path.endsWith("/users/by/username/ghost")) return ok({ errors: [{ title: "Not Found" }] }, 404);
    if (path.endsWith("/followers")) return ok(store.moreFollowers ? { data: [], meta: { next_token: "more" } } : { data: store.followers.map(id => ({ id })), meta: {} });
    if (path.endsWith("/following")) return ok({ data: store.following.map(id => ({ id })), meta: {} });
    if (path.startsWith("/2/tweets/")) return store.post ? ok({ data: store.post, includes: { users: [{ id: "42", username: "Ada" }] } }) : ok({ errors: [{ title: "Not Found" }] }, 404);
    return ok({}, 500);
  }));
});

describe("a post address", () => {
  it("reads an id from an x.com or twitter.com address, and nothing else", () => {
    expect(parseXPostId("https://x.com/Ada/status/1847920000000000099")).toBe("1847920000000000099");
    expect(parseXPostId("https://twitter.com/Ada/statuses/1847920000000000099?s=20")).toBe("1847920000000000099");
    expect(parseXPostId("99")).toBeNull();
    expect(parseXPostId("https://x.com/Ada/status/not-a-post")).toBeNull();
    expect(parseXPostId("https://example.com/status/99")).toBeNull();
  });
});

describe("what counts as a post about the site", () => {
  it("matches the name in the text, a long post or a link, and rejects a bare repost", () => {
    expect(rewards.postNamesSite({ text: "see curialy.tech" })).toBe(true);
    expect(rewards.postNamesSite({ text: "short", note_tweet: { text: "the rest mentions curialy.tech" } })).toBe(true);
    expect(rewards.postNamesSite({ text: "link", entities: { urls: [{ expanded_url: "https://curialy.tech/billing" }] } })).toBe(true);
    expect(rewards.postNamesSite({ text: "nothing about it" })).toBe(false);
    expect(rewards.isRepost({ referenced_tweets: [{ type: "retweeted", id: "1" }] })).toBe(true);
    expect(rewards.isRepost({ referenced_tweets: [{ type: "quoted", id: "1" }] })).toBe(false);
  });
});

describe("linking", () => {
  it("links the account X returns, and refuses a missing one, the account to follow, a bad name and one already used", async () => {
    expect((await rewards.linkX("u1", "@ada")).x).toMatchObject({ username: "Ada" });
    expect(store.user).toMatchObject({ x_user_id: "42", x_username: "Ada" });
    store.user = row();
    await expect(rewards.linkX("u1", "ghost")).rejects.toMatchObject({ status: 404 });
    await expect(rewards.linkX("u1", "@Yumiko_web3")).rejects.toMatchObject({ status: 400 });
    await expect(rewards.linkX("u1", "has a space")).rejects.toMatchObject({ status: 400 });
    store.failUnique = true;
    await expect(rewards.linkX("u1", "ada")).rejects.toMatchObject({ code: "x_taken", status: 409 });
  });

  it("lets a linked account be changed until a reward is claimed, and never for an account without the free credits", async () => {
    store.user = row({ x_user_id: "42", x_username: "Ada", x_linked_at: new Date() });
    expect((await rewards.unlinkX("u1")).x).toBeNull();
    store.user = row({ x_user_id: "42", x_username: "Ada", x_followed_at: new Date() });
    await expect(rewards.linkX("u1", "ada")).rejects.toMatchObject({ code: "locked" });
    store.user = row({ free_allowance_withheld: true });
    await expect(rewards.linkX("u1", "ada")).rejects.toMatchObject({ status: 403 });
  });
});

describe("claims", () => {
  const linked = () => row({ x_user_id: "42", x_username: "Ada", x_linked_at: new Date() });

  it("pays the follow reward when the account is among the followers, and says so when it isn't", async () => {
    store.user = linked();
    const result = await rewards.claimFollow("u1");
    expect(result.credits).toBe(240);
    expect(result.state.follow.claimedAt).not.toBeNull();
    expect(result.balance.bonus).toBe(240);
    expect(store.events[0]?.[1]).toBe(240);
    store.followers = [];
    store.user = linked();
    await expect(rewards.claimFollow("u1")).rejects.toMatchObject({ code: "not_following" });
    // Too many followers to read: the account's own following list is the fallback.
    store.moreFollowers = true;
    store.following = ["1646"];
    expect((await rewards.claimFollow("u1")).credits).toBe(240);
  });

  it("pays the post reward for the linked account's own post that names the site, once", async () => {
    store.user = linked();
    const result = await rewards.claimPost("u1", "https://x.com/Ada/status/1847920000000000099");
    expect(result.credits).toBe(300);
    expect(result.state.post.postUrl).toBe("https://x.com/Ada/status/1847920000000000099");
    expect(result.balance.bonus).toBe(300);
    await expect(rewards.claimPost("u1", "https://x.com/Ada/status/1847920000000000099")).rejects.toMatchObject({ code: "already_claimed" });
  });

  it("refuses a repost, someone else's post, a post that doesn't name the site, a missing post and a post already paid", async () => {
    store.user = linked();
    store.post = { ...store.post, referenced_tweets: [{ type: "retweeted", id: "1" }] };
    await expect(rewards.claimPost("u1", "https://x.com/Ada/status/1847920000000000099")).rejects.toMatchObject({ code: "post_invalid" });
    store.post = { ...store.post, referenced_tweets: undefined, author_id: "7" };
    await expect(rewards.claimPost("u1", "https://x.com/Ada/status/1847920000000000099")).rejects.toMatchObject({ code: "post_invalid" });
    store.post = { id: "1847920000000000099", text: "no mention", author_id: "42" };
    await expect(rewards.claimPost("u1", "https://x.com/Ada/status/1847920000000000099")).rejects.toMatchObject({ code: "post_invalid" });
    store.post = null;
    await expect(rewards.claimPost("u1", "https://x.com/Ada/status/1847920000000000099")).rejects.toMatchObject({ status: 404 });
    store.post = { id: "1847920000000000099", text: "curialy.tech", author_id: "42" };
    store.failUnique = true;
    await expect(rewards.claimPost("u1", "https://x.com/Ada/status/1847920000000000099")).rejects.toMatchObject({ status: 409 });
    await expect(rewards.claimPost("u1", "not a url")).rejects.toMatchObject({ status: 400 });
    store.user = row();
    await expect(rewards.claimPost("u1", "https://x.com/Ada/status/1847920000000000099")).rejects.toMatchObject({ code: "not_linked" });
  });
});
