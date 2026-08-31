import { db, links, linkTags, tags } from "@better-t-app/db";
import { ORPCError } from "@orpc/server";
import { asc, count, desc, eq, inArray } from "drizzle-orm";

import { adminProcedure, publicProcedure } from "../index";
import {
	createLinkInput,
	linkIdInput,
	listLinksInput,
	updateLinkInput,
} from "../validators/links";

async function getTagsByLinkIds(linkIds: string[]) {
	if (linkIds.length === 0)
		return new Map<
			string,
			{ id: string; name: string; normalizedName: string }[]
		>();
	const rows = await db
		.select({
			linkId: linkTags.linkId,
			id: tags.id,
			name: tags.name,
			normalizedName: tags.normalizedName,
		})
		.from(linkTags)
		.innerJoin(tags, eq(linkTags.tagId, tags.id))
		.where(inArray(linkTags.linkId, linkIds))
		.orderBy(asc(tags.normalizedName));
	const result = new Map<
		string,
		{ id: string; name: string; normalizedName: string }[]
	>();
	for (const row of rows)
		result.set(row.linkId, [
			...(result.get(row.linkId) ?? []),
			{ id: row.id, name: row.name, normalizedName: row.normalizedName },
		]);
	return result;
}

async function withTags<T extends { id: string }>(items: T[]) {
	const tagsByLink = await getTagsByLinkIds(items.map((item) => item.id));
	return items.map((item) => ({
		...item,
		tags: tagsByLink.get(item.id) ?? [],
	}));
}

async function replaceTags(
	linkId: string,
	inputTags: { name: string; normalizedName: string }[],
) {
	await db.delete(linkTags).where(eq(linkTags.linkId, linkId));
	for (const tag of inputTags) {
		await db
			.insert(tags)
			.values({ id: crypto.randomUUID(), ...tag })
			.onConflictDoNothing();
		const savedTag = await db.query.tags.findFirst({
			where: eq(tags.normalizedName, tag.normalizedName),
		});
		if (!savedTag) throw new Error("タグの保存に失敗しました。");
		await db.insert(linkTags).values({ linkId, tagId: savedTag.id });
	}
}

async function assertImageUpload(imageUploadId: string | null | undefined) {
	if (!imageUploadId) return;
	const upload = await db.query.uploads.findFirst({
		columns: { id: true },
		where: (table, operators) =>
			operators.and(
				operators.eq(table.id, imageUploadId),
				operators.eq(table.kind, "image"),
			),
	});
	if (!upload)
		throw new ORPCError("BAD_REQUEST", {
			message: "指定された画像アップロードは利用できません。",
		});
}

export const linksRouter = {
	publicList: publicProcedure
		.input(listLinksInput)
		.handler(async ({ input }) => {
			const offset = (input.page - 1) * input.pageSize;
			const [items, totalResult] = await Promise.all([
				db
					.select()
					.from(links)
					.where(eq(links.visible, true))
					.orderBy(desc(links.createdAt))
					.limit(input.pageSize)
					.offset(offset),
				db
					.select({ total: count() })
					.from(links)
					.where(eq(links.visible, true)),
			]);
			return {
				items: await withTags(items),
				page: input.page,
				pageSize: input.pageSize,
				total: totalResult[0]?.total ?? 0,
			};
		}),
	byId: adminProcedure.input(linkIdInput).handler(async ({ input }) => {
		const item = await db.query.links.findFirst({
			where: eq(links.id, input.id),
		});
		return item ? (await withTags([item]))[0] : null;
	}),
	adminList: adminProcedure.input(listLinksInput).handler(async ({ input }) => {
		const offset = (input.page - 1) * input.pageSize;
		const [items, totalResult] = await Promise.all([
			db
				.select()
				.from(links)
				.orderBy(desc(links.createdAt))
				.limit(input.pageSize)
				.offset(offset),
			db.select({ total: count() }).from(links),
		]);
		return {
			items: await withTags(items),
			page: input.page,
			pageSize: input.pageSize,
			total: totalResult[0]?.total ?? 0,
		};
	}),
	create: adminProcedure.input(createLinkInput).handler(async ({ input }) => {
		const id = crypto.randomUUID();
		const now = new Date();
		const { tags: inputTags, ...values } = input;
		await assertImageUpload(values.imageUploadId);
		await db.insert(links).values({ ...values, id, updatedAt: now });
		await replaceTags(id, inputTags);
		const item = await db.query.links.findFirst({ where: eq(links.id, id) });
		if (!item) throw new Error("リンクの保存に失敗しました。");
		return (await withTags([item]))[0];
	}),
	update: adminProcedure.input(updateLinkInput).handler(async ({ input }) => {
		const { id, tags: inputTags, ...values } = input;
		await assertImageUpload(values.imageUploadId);
		const updated = await db
			.update(links)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(links.id, id))
			.returning();
		if (!updated[0]) return null;
		if (inputTags) await replaceTags(id, inputTags);
		return (await withTags([updated[0]]))[0];
	}),
	remove: adminProcedure.input(linkIdInput).handler(async ({ input }) => {
		const deleted = await db
			.delete(links)
			.where(eq(links.id, input.id))
			.returning({ id: links.id });
		return { deleted: deleted.length === 1 };
	}),
};
