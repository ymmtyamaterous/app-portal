import { expect, test } from "bun:test";

import { createLinkInput, normalizeTag, updateLinkInput } from "./links";

test("タグは NFC・前後トリム・空白圧縮・Unicode小文字化される", () => {
	expect(normalizeTag("  Ｃafe\u0301   PORTAL ")).toBe("ｃafé portal");
});

test("重複タグは正規化名で統合される", () => {
	const result = createLinkInput.parse({
		title: "Portal",
		url: "https://example.test",
		tags: [" News ", "news", "開発  情報"],
	});
	expect(result.tags).toEqual([
		{ name: "News", normalizedName: "news" },
		{ name: "開発 情報", normalizedName: "開発 情報" },
	]);
});

test("http と https 以外のURLおよび空更新を拒否する", () => {
	expect(() => createLinkInput.parse({ title: "Unsafe", url: "javascript:alert(1)" })).toThrow();
	expect(() => updateLinkInput.parse({ id: crypto.randomUUID() })).toThrow();
});