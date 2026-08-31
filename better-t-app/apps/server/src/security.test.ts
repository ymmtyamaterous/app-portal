import { expect, test } from "bun:test";

import { createRateLimiter, getClientAddress } from "./security";

test("rate limiter rejects requests after its configured maximum", () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 1_000 });

  expect(limiter.consume("192.0.2.1", 0).allowed).toBe(true);
  expect(limiter.consume("192.0.2.1", 1).allowed).toBe(true);
  expect(limiter.consume("192.0.2.1", 2)).toEqual({ allowed: false, retryAfterMs: 998 });
  expect(limiter.consume("192.0.2.1", 1_000).allowed).toBe(true);
});

test("forwarded client address is used only for trusted proxies", () => {
  const request = new Request("https://example.test", {
    headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.4", "x-real-ip": "203.0.113.4" },
  });

  expect(getClientAddress(request, true)).toBe("198.51.100.10");
  expect(getClientAddress(request, false)).toBe("unknown");
});