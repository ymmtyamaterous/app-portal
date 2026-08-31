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
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createRateLimiter, getClientAddress, securityHeaders } from "./security";

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
    const result = loginRateLimiter.consume(getClientAddress(c.req.raw, env.TRUST_PROXY));
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
    const result = uploadRateLimiter.consume(getClientAddress(c.req.raw, env.TRUST_PROXY));
    if (!result.allowed) {
      c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
      return c.json({ message: "Too many requests" }, 429);
    }
  }
  await next();
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
