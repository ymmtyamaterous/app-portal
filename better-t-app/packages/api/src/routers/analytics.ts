import { count, desc, eq, gte, max, sql } from "drizzle-orm";
import { accessLogs, db, linkTags, links, tags } from "@better-t-app/db";
import { z } from "zod";

import { getPeriodStart, hashIpAddress, type AnalyticsPeriod } from "../analytics";
import { adminProcedure, publicProcedure } from "../index";

const periodInput = z.object({ period: z.enum(["all", "7d", "30d"]).default("all") });
const linkIdInput = z.object({ linkId: z.string().uuid() });

function accessCondition(period: AnalyticsPeriod, now: Date) {
	const start = getPeriodStart(period, now);
	return start ? gte(accessLogs.accessedAt, start) : undefined;
}

async function accessMetrics(period: AnalyticsPeriod, now: Date) {
	const condition = accessCondition(period, now);
	const query = db
		.select({
			clicks: count(accessLogs.id),
			uniqueLinks: sql<number>`count(distinct ${accessLogs.linkId})`,
		})
		.from(accessLogs);
	const rows = condition ? await query.where(condition) : await query;
	return { clicks: rows[0]?.clicks ?? 0, uniqueLinks: Number(rows[0]?.uniqueLinks ?? 0) };
}

export const analyticsRouter = {
	recordAccess: publicProcedure.input(linkIdInput).handler(async ({ context, input }) => {
		const link = await db.query.links.findFirst({
			columns: { id: true },
			where: (table, operators) => operators.and(operators.eq(table.id, input.linkId), operators.eq(table.visible, true)),
		});
		if (!link) return { recorded: false };

		await db.insert(accessLogs).values({
			id: crypto.randomUUID(),
			linkId: link.id,
			ipHashSha256: await hashIpAddress(context.clientIp, process.env.BETTER_AUTH_SECRET ?? ""),
			accessedAt: new Date(),
		});
		return { recorded: true };
	}),
	popular: adminProcedure.input(periodInput).handler(async ({ input }) => {
		const now = new Date();
		const condition = accessCondition(input.period, now);
		const rows = await db
			.select({
				id: links.id,
				title: links.title,
				url: links.url,
				clicks: count(accessLogs.id),
				lastAccessedAt: max(accessLogs.accessedAt),
			})
			.from(links)
			.leftJoin(accessLogs, condition ? sql`${eq(accessLogs.linkId, links.id)} and ${condition}` : eq(accessLogs.linkId, links.id))
			.groupBy(links.id)
			.orderBy(desc(count(accessLogs.id)), desc(max(accessLogs.accessedAt)), links.id)
			.limit(10);
		return rows;
	}),
	summary: adminProcedure.handler(async () => {
		const now = new Date();
		const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		const [linkCount, all, todayMetrics, sevenDays, thirtyDays] = await Promise.all([
			db.select({ total: count() }).from(links),
			accessMetrics("all", now),
			accessMetricsForStart(today),
			accessMetrics("7d", now),
			accessMetrics("30d", now),
		]);
		return {
			totalLinks: linkCount[0]?.total ?? 0,
			totalClicks: all.clicks,
			uniqueLinks: all.uniqueLinks,
			todayClicks: todayMetrics.clicks,
			sevenDayClicks: sevenDays.clicks,
			thirtyDayClicks: thirtyDays.clicks,
		};
	}),
	exportLinksJson: adminProcedure.handler(async () => {
		const rows = await db
			.select({
				id: links.id,
				title: links.title,
				url: links.url,
				description: links.description,
				visible: links.visible,
				createdAt: links.createdAt,
				updatedAt: links.updatedAt,
				tag: tags.name,
				normalizedTag: tags.normalizedName,
			})
			.from(links)
			.leftJoin(linkTags, eq(linkTags.linkId, links.id))
			.leftJoin(tags, eq(tags.id, linkTags.tagId))
			.orderBy(links.id, tags.normalizedName);
		const byId = new Map<string, { id: string; title: string; url: string; description: string | null; visible: boolean; createdAt: Date; updatedAt: Date; tags: { name: string; normalizedName: string }[] }>();
		for (const row of rows) {
			const item = byId.get(row.id) ?? { ...row, tags: [] };
			if (row.tag && row.normalizedTag) item.tags.push({ name: row.tag, normalizedName: row.normalizedTag });
			byId.set(row.id, item);
		}
		const now = new Date();
		return {
			filename: `portal-links-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`,
			links: Array.from(byId.values()),
		};
	}),
};

async function accessMetricsForStart(start: Date) {
	const rows = await db
		.select({ clicks: count(accessLogs.id), uniqueLinks: sql<number>`count(distinct ${accessLogs.linkId})` })
		.from(accessLogs)
		.where(gte(accessLogs.accessedAt, start));
	return { clicks: rows[0]?.clicks ?? 0, uniqueLinks: Number(rows[0]?.uniqueLinks ?? 0) };
}