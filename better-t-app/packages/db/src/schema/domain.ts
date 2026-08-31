import { relations, sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const uploads = sqliteTable(
	"uploads",
	{
		id: text("id").primaryKey(),
		kind: text("kind", { enum: ["image", "apk"] }).notNull(),
		storedName: text("stored_name").notNull(),
		originalName: text("original_name"),
		mimeType: text("mime_type"),
		sizeBytes: integer("size_bytes"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).default(createdAtDefault).notNull(),
	},
	(table) => [index("uploads_kind_created_at_idx").on(table.kind, table.createdAt)],
);

export const links = sqliteTable(
	"links",
	{
		id: text("id").primaryKey(),
		title: text("title").notNull(),
		url: text("url").notNull(),
		description: text("description"),
		visible: integer("visible", { mode: "boolean" }).default(true).notNull(),
		imageUploadId: text("image_upload_id").references(() => uploads.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).default(createdAtDefault).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("links_visible_created_at_idx").on(table.visible, table.createdAt)],
);

export const tags = sqliteTable(
	"tags",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		normalizedName: text("normalized_name").notNull().unique(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).default(createdAtDefault).notNull(),
	},
	(table) => [index("tags_normalized_name_idx").on(table.normalizedName)],
);

export const linkTags = sqliteTable(
	"link_tags",
	{
		linkId: text("link_id")
			.notNull()
			.references(() => links.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id),
	},
	(table) => [
		primaryKey({ columns: [table.linkId, table.tagId] }),
		index("link_tags_tag_id_link_id_idx").on(table.tagId, table.linkId),
	],
);

export const accessLogs = sqliteTable(
	"access_logs",
	{
		id: text("id").primaryKey(),
		linkId: text("link_id")
			.notNull()
			.references(() => links.id, { onDelete: "cascade" }),
		ipHashSha256: text("ip_hash_sha256").notNull(),
		accessedAt: integer("accessed_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		index("access_logs_link_id_accessed_at_idx").on(table.linkId, table.accessedAt),
		index("access_logs_accessed_at_idx").on(table.accessedAt),
	],
);

export const uploadRelations = relations(uploads, ({ many }) => ({
	links: many(links),
}));

export const linkRelations = relations(links, ({ many, one }) => ({
	image: one(uploads, { fields: [links.imageUploadId], references: [uploads.id] }),
	tags: many(linkTags),
	accessLogs: many(accessLogs),
}));

export const tagRelations = relations(tags, ({ many }) => ({
	links: many(linkTags),
}));

export const linkTagRelations = relations(linkTags, ({ one }) => ({
	link: one(links, { fields: [linkTags.linkId], references: [links.id] }),
	tag: one(tags, { fields: [linkTags.tagId], references: [tags.id] }),
}));

export const accessLogRelations = relations(accessLogs, ({ one }) => ({
	link: one(links, { fields: [accessLogs.linkId], references: [links.id] }),
}));