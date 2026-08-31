import { createContext } from "@better-t-app/api/context";
import { appRouter } from "@better-t-app/api/routers/index";
import { auth } from "@better-t-app/auth";
import { initializeDatabase } from "@better-t-app/db";
import { env } from "@better-t-app/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { getApk, getPublicImage, saveUpload } from "./file-service";
import {
	createRateLimiter,
	getClientAddress,
	securityHeaders,
} from "./security";
import { type UploadKind, UploadValidationError } from "./upload-validation";

const app = new Hono();
const loginRateLimiter = createRateLimiter({
	max: env.LOGIN_RATE_LIMIT_MAX,
	windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
});
const uploadRateLimiter = createRateLimiter({
	max: env.UPLOAD_RATE_LIMIT_MAX,
	windowMs: env.UPLOAD_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
});

await initializeDatabase();

app.use(logger());
app.use("/*", securityHeaders);
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.use("/api/auth/*", async (c, next) => {
	c.header("Cache-Control", "no-store");

	if (c.req.method === "POST" && c.req.path === "/api/auth/sign-in/email") {
		const result = loginRateLimiter.consume(
			getClientAddress(c.req.raw, env.TRUST_PROXY),
		);
		if (!result.allowed) {
			c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
			return c.json({ message: "Too many requests" }, 429);
		}
	}

	await next();
});

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use("/api/uploads/*", async (c, next) => {
	if (c.req.method === "POST") {
		const result = uploadRateLimiter.consume(
			getClientAddress(c.req.raw, env.TRUST_PROXY),
		);
		if (!result.allowed) {
			c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
			return c.json({ message: "Too many requests" }, 429);
		}
	}
	await next();
});

async function requireAdmin(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) return { status: 401 as const };
	if (session.user.role !== "admin") return { status: 403 as const };
	return { session };
}

async function singleUploadFile(request: Request, kind: UploadKind) {
	const contentLength = Number(request.headers.get("content-length"));
	const maximum = kind === "image" ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
	if (Number.isFinite(contentLength) && contentLength > maximum + 16 * 1024) {
		throw new UploadValidationError(
			"ファイルサイズが上限を超えています。",
			413,
		);
	}
	const formData = await request.formData();
	const entries = Array.from(formData.entries());
	if (
		entries.length !== 1 ||
		entries[0]?.[0] !== "file" ||
		!(entries[0][1] instanceof File)
	) {
		throw new UploadValidationError(
			"file フィールドにファイルを1件だけ指定してください。",
			400,
		);
	}
	return entries[0][1];
}

async function handleUpload(c: Context, kind: UploadKind) {
	c.header("Cache-Control", "no-store");
	const authorization = await requireAdmin(c.req.raw);
	if ("status" in authorization)
		return c.json({ message: "Unauthorized" }, authorization.status);
	try {
		const file = await singleUploadFile(c.req.raw, kind);
		return c.json(await saveUpload(env.UPLOADS_ROOT, kind, file), 201);
	} catch (error) {
		if (error instanceof UploadValidationError)
			return c.json({ message: error.message }, error.status);
		console.error(error);
		return c.json({ message: "アップロードに失敗しました。" }, 500);
	}
}

app.post("/api/uploads/images", (c) => handleUpload(c, "image"));
app.post("/api/uploads/apks", (c) => handleUpload(c, "apk"));

app.get("/media/images/:uploadId", async (c) => {
	const image = await getPublicImage(env.UPLOADS_ROOT, c.req.param("uploadId"));
	if (!image) return c.json({ message: "Not found" }, 404);
	return c.body(image.bytes, 200, {
		"Content-Type": image.mimeType ?? "application/octet-stream",
		"Content-Disposition": "inline",
		"X-Content-Type-Options": "nosniff",
	});
});

app.get("/downloads/apks/:uploadId", async (c) => {
	const authorization = await requireAdmin(c.req.raw);
	if ("status" in authorization)
		return c.json({ message: "Unauthorized" }, authorization.status);
	const apk = await getApk(env.UPLOADS_ROOT, c.req.param("uploadId"));
	if (!apk) return c.json({ message: "Not found" }, 404);
	return c.body(apk.bytes, 200, {
		"Content-Type": apk.mimeType ?? "application/vnd.android.package-archive",
		"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(apk.originalName ?? "download.apk")}`,
		"X-Content-Type-Options": "nosniff",
	});
});

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

app.use("/*", async (c, next) => {
	if (c.req.path.startsWith("/rpc")) {
		c.header("Cache-Control", "no-store");
	}
	const context = await createContext({
		context: c,
		clientIp: getClientAddress(c.req.raw, env.TRUST_PROXY),
	});

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context: context,
	});

	if (rpcResult.matched) {
		return c.newResponse(rpcResult.response.body, rpcResult.response);
	}

	const apiResult = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context: context,
	});

	if (apiResult.matched) {
		return c.newResponse(apiResult.response.body, apiResult.response);
	}

	await next();
});

app.get("/", (c) => {
	return c.text("OK");
});

export default app;
