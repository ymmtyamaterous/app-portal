import { expect, test } from "bun:test";

import { isValidPasswordLength } from "./validation";

test("password length must be between 12 and 128 characters", () => {
  expect(isValidPasswordLength("a".repeat(11))).toBe(false);
  expect(isValidPasswordLength("a".repeat(12))).toBe(true);
  expect(isValidPasswordLength("a".repeat(128))).toBe(true);
  expect(isValidPasswordLength("a".repeat(129))).toBe(false);
});