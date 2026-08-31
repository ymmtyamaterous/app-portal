export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const APK_MAX_BYTES = 100 * 1024 * 1024;

const imageTypes = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
} as const;

export type UploadKind = "image" | "apk";
export type ValidatedUpload = { extension: string; mimeType: string };

export class UploadValidationError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 413 | 415,
	) {
		super(message);
	}
}

function extensionOf(name: string) {
	return name.includes(".")
		? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
		: "";
}

function startsWith(bytes: Uint8Array, signature: number[]) {
	return signature.every((value, index) => bytes[index] === value);
}

function imageMimeType(bytes: Uint8Array) {
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return "image/png";
	if (
		startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
		startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
	)
		return "image/gif";
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
	)
		return "image/webp";
	return null;
}

function littleEndian(bytes: Uint8Array, offset: number, width: number) {
	let value = 0;
	for (let index = 0; index < width; index++)
		value += (bytes[offset + index] ?? 0) * 2 ** (8 * index);
	return value;
}

/** Checks the ZIP central directory without extracting attacker-controlled content. */
export function hasAndroidManifest(bytes: Uint8Array) {
	if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false;
	const lowerBound = Math.max(0, bytes.length - 65_557);
	let eocd = -1;
	for (let offset = bytes.length - 22; offset >= lowerBound; offset--) {
		if (startsWith(bytes.slice(offset), [0x50, 0x4b, 0x05, 0x06])) {
			eocd = offset;
			break;
		}
	}
	if (eocd < 0 || eocd + 22 > bytes.length) return false;
	const entries = littleEndian(bytes, eocd + 10, 2);
	let offset = littleEndian(bytes, eocd + 16, 4);
	if (entries === 0 || offset >= bytes.length) return false;
	const decoder = new TextDecoder();
	for (let entry = 0; entry < entries; entry++) {
		if (
			!startsWith(bytes.slice(offset), [0x50, 0x4b, 0x01, 0x02]) ||
			offset + 46 > bytes.length
		)
			return false;
		const nameLength = littleEndian(bytes, offset + 28, 2);
		const extraLength = littleEndian(bytes, offset + 30, 2);
		const commentLength = littleEndian(bytes, offset + 32, 2);
		const end = offset + 46 + nameLength + extraLength + commentLength;
		if (end > bytes.length) return false;
		if (
			decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)) ===
			"AndroidManifest.xml"
		)
			return true;
		offset = end;
	}
	return false;
}

export function validateUpload(
	kind: UploadKind,
	originalName: string,
	bytes: Uint8Array,
): ValidatedUpload {
	const maxBytes = kind === "image" ? IMAGE_MAX_BYTES : APK_MAX_BYTES;
	if (bytes.byteLength > maxBytes)
		throw new UploadValidationError(
			"ファイルサイズが上限を超えています。",
			413,
		);
	const extension = extensionOf(originalName);
	if (kind === "image") {
		const expectedMimeType = imageTypes[extension as keyof typeof imageTypes];
		const detectedMimeType = imageMimeType(bytes);
		if (
			!expectedMimeType ||
			!detectedMimeType ||
			expectedMimeType !== detectedMimeType
		) {
			throw new UploadValidationError(
				"JPEG、PNG、GIF、WebP の画像を指定してください。",
				415,
			);
		}
		return { extension, mimeType: detectedMimeType };
	}
	if (extension !== "apk" || !hasAndroidManifest(bytes)) {
		throw new UploadValidationError(
			"有効な APK ファイルを指定してください。",
			415,
		);
	}
	return { extension, mimeType: "application/vnd.android.package-archive" };
}
