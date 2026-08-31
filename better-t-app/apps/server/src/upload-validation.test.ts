import { expect, test } from "bun:test";

import {
	hasAndroidManifest,
	UploadValidationError,
	validateUpload,
} from "./upload-validation";

function zipWithManifest() {
	const name = new TextEncoder().encode("AndroidManifest.xml");
	const local = new Uint8Array(30 + name.length);
	local.set([0x50, 0x4b, 0x03, 0x04]);
	local.set(name, 30);
	const central = new Uint8Array(46 + name.length);
	central.set([0x50, 0x4b, 0x01, 0x02], 0);
	central[28] = name.length;
	central.set(name, 46);
	const eocd = new Uint8Array(22);
	eocd.set([0x50, 0x4b, 0x05, 0x06], 0);
	eocd[8] = 1;
	eocd[10] = 1;
	eocd[12] = central.length;
	eocd[16] = local.length;
	return new Uint8Array([...local, ...central, ...eocd]);
}

test("画像は拡張子とマジックバイトの両方を検証する", () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	expect(validateUpload("image", "cover.png", png)).toEqual({
		extension: "png",
		mimeType: "image/png",
	});
	expect(() => validateUpload("image", "cover.jpg", png)).toThrow(
		UploadValidationError,
	);
	expect(() =>
		validateUpload("image", "cover.svg", new TextEncoder().encode("<svg/>")),
	).toThrow(UploadValidationError);
	expect(() =>
		validateUpload("image", "large.png", new Uint8Array(10 * 1024 * 1024 + 1)),
	).toThrow(UploadValidationError);
});

test("APK は ZIP と AndroidManifest.xml を要求する", () => {
	const apk = zipWithManifest();
	expect(hasAndroidManifest(apk)).toBe(true);
	expect(validateUpload("apk", "app.apk", apk).mimeType).toBe(
		"application/vnd.android.package-archive",
	);
	expect(() =>
		validateUpload("apk", "app.apk", new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
	).toThrow(UploadValidationError);
});
