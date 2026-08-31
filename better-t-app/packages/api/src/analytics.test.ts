import { expect, test } from "bun:test";

import { getPeriodStart, getUtcDay, hashIpAddress } from "./analytics";

test("分析期間はUTC日の開始時刻を基準にする", () => {
	const now = new Date("2026-08-31T23:59:59.999Z");
	expect(getPeriodStart("all", now)).toBeUndefined();
	expect(getPeriodStart("7d", now)?.toISOString()).toBe("2026-08-24T00:00:00.000Z");
	expect(getPeriodStart("30d", now)?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
	expect(getUtcDay(now)).toBe("2026-08-31");
});

test("IPハッシュは同じUTC日では安定し、日が変わると変化する", async () => {
	const first = await hashIpAddress("192.0.2.1", "test-secret", new Date("2026-08-31T12:00:00Z"));
	const sameDay = await hashIpAddress("192.0.2.1", "test-secret", new Date("2026-08-31T23:59:59Z"));
	const nextDay = await hashIpAddress("192.0.2.1", "test-secret", new Date("2026-09-01T00:00:00Z"));
	expect(first).toHaveLength(64);
	expect(sameDay).toBe(first);
	expect(nextDay).not.toBe(first);
});