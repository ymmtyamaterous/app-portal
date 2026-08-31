import { z } from "zod";

const maxTagsPerLink = 20;

export function normalizeTag(value: string) {
	return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function displayTagName(value: string) {
	return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

const tagInput = z.string().transform((value, context) => {
	const name = displayTagName(value);
	if (name.length < 1 || name.length > 30) {
		context.addIssue({ code: "custom", message: "タグは1〜30文字で入力してください。" });
		return z.NEVER;
	}
	return { name, normalizedName: normalizeTag(name) };
});

const urlInput = z
	.string()
	.trim()
	.max(2048)
	.url()
	.refine((value) => {
		const protocol = new URL(value).protocol;
		return protocol === "http:" || protocol === "https:";
	}, "http または https の URL を指定してください。");

const tagsInput = z
	.array(tagInput)
	.max(maxTagsPerLink)
	.transform((values) => {
		const uniqueTags = new Map<string, (typeof values)[number]>();
		for (const tag of values) {
			if (!uniqueTags.has(tag.normalizedName)) uniqueTags.set(tag.normalizedName, tag);
		}
		return Array.from(uniqueTags.values());
	});

const linkFields = {
	title: z.string().trim().min(1).max(120),
	url: urlInput,
	description: z.string().trim().max(2000).nullable().optional(),
	visible: z.boolean().optional(),
	imageUploadId: z.string().uuid().nullable().optional(),
	tags: tagsInput.optional(),
};

export const createLinkInput = z.object({
	...linkFields,
	visible: z.boolean().default(true),
	tags: tagsInput.default([]),
});

export const updateLinkInput = z
	.object({ id: z.string().uuid(), ...linkFields })
	.refine((value) => Object.keys(value).some((key) => key !== "id"), "更新項目を指定してください。");

export const listLinksInput = z.object({
	page: z.number().int().min(1).default(1),
	pageSize: z.number().int().min(1).max(100).default(24),
});

export const linkIdInput = z.object({ id: z.string().uuid() });