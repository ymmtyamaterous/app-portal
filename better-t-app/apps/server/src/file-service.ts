import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { accessLogs, db, links, uploads } from "@better-t-app/db";
import { and, eq, lt } from "drizzle-orm";

import { type UploadKind, validateUpload } from "./upload-validation";

const storedNamePattern = /^[0-9a-f-]{36}\.(?:jpg|jpeg|png|gif|webp|apk)$/;

function uploadDirectory(root: string, kind: UploadKind) {
	return resolve(root, kind === "image" ? "images" : "apk");
}

function safeOriginalName(name: string) {
	const safeName = Array.from(basename(name))
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.slice(0, 255);
	return safeName || "upload";
}

function storedPath(root: string, kind: UploadKind, storedName: string) {
	if (!storedNamePattern.test(storedName)) return null;
	const directory = uploadDirectory(root, kind);
	const path = resolve(directory, storedName);
	return path.startsWith(`${directory}/`) ? path : null;
}

export async function saveUpload(root: string, kind: UploadKind, file: File) {
	const originalName = safeOriginalName(file.name);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const { extension, mimeType } = validateUpload(kind, originalName, bytes);
	const id = crypto.randomUUID();
	const storedName = `${id}.${extension}`;
	const directory = uploadDirectory(root, kind);
	const finalPath = storedPath(root, kind, storedName);
	if (!finalPath) throw new Error("アップロード保存先を解決できません。");
	const temporaryPath = join(directory, `.${id}.uploading`);

	await mkdir(directory, { recursive: true });
	try {
		await writeFile(temporaryPath, bytes, { flag: "wx" });
		await db
			.insert(uploads)
			.values({
				id,
				kind,
				storedName,
				originalName,
				mimeType,
				sizeBytes: bytes.byteLength,
			});
		try {
			await rename(temporaryPath, finalPath);
		} catch (error) {
			await db.delete(uploads).where(eq(uploads.id, id));
			throw error;
		}
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}

	return {
		id,
		kind,
		storedName,
		originalName,
		mimeType,
		sizeBytes: bytes.byteLength,
	};
}

export async function getPublicImage(root: string, uploadId: string) {
	const result = await db
		.select({
			storedName: uploads.storedName,
			mimeType: uploads.mimeType,
			originalName: uploads.originalName,
		})
		.from(uploads)
		.innerJoin(
			links,
			and(eq(links.imageUploadId, uploads.id), eq(links.visible, true)),
		)
		.where(and(eq(uploads.id, uploadId), eq(uploads.kind, "image")))
		.limit(1);
	const upload = result[0];
	if (!upload) return null;
	const path = storedPath(root, "image", upload.storedName);
	if (!path) return null;
	try {
		return { ...upload, bytes: await readFile(path) };
	} catch {
		return null;
	}
}

export async function getApk(root: string, uploadId: string) {
	const upload = await db.query.uploads.findFirst({
		where: (table, operators) =>
			operators.and(
				operators.eq(table.id, uploadId),
				operators.eq(table.kind, "apk"),
			),
	});
	if (!upload) return null;
	const path = storedPath(root, "apk", upload.storedName);
	if (!path) return null;
	try {
		return { ...upload, bytes: await readFile(path) };
	} catch {
		return null;
	}
}

export async function cleanupAccessLogs(
	retentionDays: number,
	now = new Date(),
) {
	const cutoff = new Date(
		Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate() - retentionDays,
		),
	);
	const deleted = await db
		.delete(accessLogs)
		.where(lt(accessLogs.accessedAt, cutoff))
		.returning({ id: accessLogs.id });
	return { cutoff: cutoff.toISOString(), deleted: deleted.length };
}
