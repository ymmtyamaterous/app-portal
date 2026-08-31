import type { RouterClient } from "@orpc/server";

import { adminProcedure, protectedProcedure, publicProcedure } from "../index";
import { analyticsRouter } from "./analytics";
import { linksRouter } from "./links";
import { uploadsRouter } from "./uploads";

export const appRouter = {
	healthCheck: publicProcedure.handler(() => {
		return "OK";
	}),
	privateData: protectedProcedure.handler(({ context }) => {
		return {
			message: "This is private",
			user: context.session?.user,
		};
	}),
	adminData: adminProcedure.handler(() => {
		return { message: "This is admin-only" };
	}),
	analytics: analyticsRouter,
	links: linksRouter,
	uploads: uploadsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
