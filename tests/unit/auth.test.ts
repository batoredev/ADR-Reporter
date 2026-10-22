import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "@/server/auth/rate-limit";

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("rejects a login for an unknown account", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
  });
});

describe("login rate limit", () => {
  it("blocks after ten failures within fifteen minutes, then resets", () => {
    const key = "someone@demo.test|local";
    const start = 1_000_000;
    for (let i = 0; i < 9; i += 1) recordLoginFailure(key, start);
    expect(isLoginBlocked(key, start)).toBe(false);
    recordLoginFailure(key, start);
    expect(isLoginBlocked(key, start)).toBe(true);
    expect(isLoginBlocked(key, start + 16 * 60 * 1000)).toBe(false);
    clearLoginFailures(key);
  });
});
