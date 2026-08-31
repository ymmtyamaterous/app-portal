import { db, uploads } from "@better-t-app/db";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { adminProcedure } from "../index";

const listUploadsInput = z.object({
	kind: z.enum(["image", "apk"]).optional(),
	page: z.number().int().min(1).default(1),
	pageSize: z.number().int().min(1).max(100).default(24),
});

export const uploadsRouter = {
	list: adminProcedure.input(listUploadsInput).handler(async ({ input }) => {
		const offset = (input.page - 1) * input.pageSize;
		const query = db.select().from(uploads);
		const countQuery = db.select({ total: count() }).from(uploads);
		const [items, totalResult] = input.kind
			? await Promise.all([
					query
						.where(eq(uploads.kind, input.kind))
						.orderBy(desc(uploads.createdAt))
						.limit(input.pageSize)
						.offset(offset),
					countQuery.where(eq(uploads.kind, input.kind)),
				])
			: await Promise.all([
					query
						.orderBy(desc(uploads.createdAt))
						.limit(input.pageSize)
						.offset(offset),
					countQuery,
				]);
		return {
			items,
			page: input.page,
			pageSize: input.pageSize,
			total: totalResult[0]?.total ?? 0,
		};
	}),
};
