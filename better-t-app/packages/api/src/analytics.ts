export type AnalyticsPeriod = "all" | "7d" | "30d";

export function getPeriodStart(period: AnalyticsPeriod, now = new Date()) {
	if (period === "all") return undefined;
	const days = period === "7d" ? 7 : 30;
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

export function getUtcDay(value = new Date()) {
	return value.toISOString().slice(0, 10);
}

export async function hashIpAddress(ipAddress: string, secret: string, now = new Date()) {
	const value = new TextEncoder().encode(`${secret}:${getUtcDay(now)}:${ipAddress}`);
	const digest = await crypto.subtle.digest("SHA-256", value);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}