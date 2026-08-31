import type { MiddlewareHandler } from "hono";

type RateLimitOptions = {
  max: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export function createRateLimiter({ max, windowMs }: RateLimitOptions) {
  const entries = new Map<string, RateLimitEntry>();

  return {
    consume(key: string, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (entry.count >= max) {
        return { allowed: false, retryAfterMs: entry.resetAt - now };
      }
      entry.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

export function getClientAddress(request: Request, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    const firstForwardedAddress = forwarded?.split(",")[0]?.trim();
    if (firstForwardedAddress) {
      return firstForwardedAddress;
    }
  }
  return "unknown";
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  );
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  await next();
};