import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { SKILLS } from "@shared/skills";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { executeTask } from "./ai/curialy";
import { ENV } from "./_core/env";
import { addEvent, addMessage, deleteTask, getTask, listEvents, listTasks, saveTask } from "./curialy-store";

const taskInput = z.object({
  clientId: z.string().uuid().optional(),
  prompt: z.string().trim().min(2, "Tell Curialy what you want to accomplish.").max(12000),
  model: z.string().trim().max(120).default("gemini-3-flash-preview"),
  think: z.boolean().default(false),
  webSearch: z.boolean().default(false),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  skills: router({
    list: publicProcedure.query(() => SKILLS),
  }),
  integrations: router({
    health: publicProcedure.query(() => ({
      provider: ENV.forgeApiUrl && ENV.forgeApiKey ? "configured" : "missing_credentials",
      search: "provider_grounding_available",
      voice: "fallback_available",
      persistence: "sqlite_available",
    })),
  }),
  tasks: router({
    list: publicProcedure.query(() => ({ tasks: listTasks(), events: listEvents() })),
    get: publicProcedure.input(z.object({ id: z.string().min(1) })).query(({ input }) => getTask(input.id) ?? null),
    remove: publicProcedure.input(z.object({ id: z.string().min(1) })).mutation(({ input }) => ({ deleted: deleteTask(input.id) })),
    create: publicProcedure.input(taskInput).mutation(async ({ input }) => {
      const startedAt = new Date().toISOString();
      const id = input.clientId ?? crypto.randomUUID();
      const baseTask = { id, prompt: input.prompt, status: "running" as const, model: input.model, think: input.think, webSearch: input.webSearch, createdAt: startedAt, updatedAt: startedAt };
      saveTask(baseTask);
      addMessage(id, "user", input.prompt);
      addEvent(id, "Task started", input.prompt);
      try {
        const result = await executeTask(input);
        const finished = saveTask({ ...baseTask, status: "completed", answer: result.answer, plan: result.plan, skillsUsed: result.skillsUsed, provider: result.provider, limitation: result.limitation, updatedAt: new Date().toISOString() });
        addMessage(id, "assistant", result.answer);
        addEvent(id, "Task completed", result.provider === "platform-llm" ? "Provider response received." : "Completed with a local limitation.");
        return { taskId: id, ...result, persistedTask: finished, startedAt, completedAt: new Date().toISOString() };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Curialy could not complete this task.";
        const failed = saveTask({ ...baseTask, status: "failed", plan: ["Retry the request after checking integration health."], skillsUsed: [], provider: "local-demo", limitation: message, updatedAt: new Date().toISOString() });
        addEvent(id, "Task failed", message);
        return {
          taskId: id,
          answer: "Curialy could not complete this task. Your prompt was preserved so you can retry after checking the integration settings.",
          skillsUsed: [],
          plan: ["Retry the request after checking integration health."],
          provider: "local-demo" as const,
          limitation: message,
          persistedTask: failed,
          startedAt,
          completedAt: new Date().toISOString(),
        };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
