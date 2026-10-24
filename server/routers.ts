import { COOKIE_NAME } from "@shared/const";
import { SKILLS } from "@shared/skills";
import { ADMIN_COOKIE, authConfigured } from "./auth";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { operatorProcedure, publicProcedure, router } from "./_core/trpc";

// Agent tasks, streaming and workspace access live in the Express router at /api/agent
// (server/agent/routes.ts) because they need SSE and file downloads.
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ({ admin: Boolean(ctx.admin), configured: authConfigured() })),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(ADMIN_COOKIE, { path: "/" });
      return { success: true } as const;
    }),
  }),
  skills: router({
    list: operatorProcedure.query(() => SKILLS),
  }),
});

export type AppRouter = typeof appRouter;
