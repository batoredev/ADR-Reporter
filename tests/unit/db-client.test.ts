import { parse } from "pg-connection-string";
import { describe, expect, it } from "vitest";
import { withLibpqSslModes } from "@/server/db-client";

describe("database connection strings", () => {
  it("gives sslmode=require PostgreSQL's meaning: encrypted, certificate not verified", () => {
    const url = withLibpqSslModes("postgresql://u:p@db.example.test:5432/postgres?sslmode=require");
    expect(parse(url).ssl).toEqual({ rejectUnauthorized: false });
  });

  it("still verifies certificates with verify-full", () => {
    const url = withLibpqSslModes("postgresql://u:p@db.example.test:5432/postgres?sslmode=verify-full");
    expect(parse(url).ssl).toEqual({});
  });

  it("leaves strings without sslmode, or already choosing, unchanged", () => {
    const local = "postgresql://adr:pw@localhost:5432/adr_reporter?schema=public";
    expect(withLibpqSslModes(local)).toBe(local);
    const chosen = "postgresql://u:p@h/db?sslmode=require&uselibpqcompat=false";
    expect(withLibpqSslModes(chosen)).toBe(chosen);
  });
});
