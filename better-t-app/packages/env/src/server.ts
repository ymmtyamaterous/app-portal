import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    UPLOADS_ROOT: z.string().min(1).default("./uploads"),
    ACCESS_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
    UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
    UPLOAD_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(60),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
