import { COOKIE_NAME } from "@shared/const";
import { SKILLS } from "@shared/skills";
import { ADMIN_COOKIE, authConfigured, USER_COOKIE } from "./auth";
import { getSettings } from "./credits";
import { oauthConfigured } from "./services/github";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { accountProcedure, publicProcedure, router } from "./_core/trpc";

// Agent tasks, streaming and workspace access live in the Express router at /api/agent
// (server/agent/routes.ts) because they need SSE and file downloads.
export const appRouter = router({
  system: systemRouter,
  auth: router({
    // configured: operator password sign-in is set up; github: GitHub sign-in is available.
    me: publicProcedure.query(async ({ ctx }) => ({
      user: ctx.account ? { id: ctx.account.id, login: ctx.account.login, name: ctx.account.displayName, avatarUrl: ctx.account.avatarUrl, role: ctx.account.role } : null,
      admin: Boolean(ctx.admin),
      configured: authConfigured(),
      github: oauthConfigured(),
      signupsOpen: (await getSettings().catch(() => null))?.signupsOpen ?? true,
    })),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(ADMIN_COOKIE, { path: "/" });
      ctx.res.clearCookie(USER_COOKIE, { path: "/" });
      return { success: true } as const;
    }),
  }),
  skills: router({
    list: accountProcedure.query(() => SKILLS),
  }),
});

export type AppRouter = typeof appRouter;
