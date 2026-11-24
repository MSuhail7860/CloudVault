import { describe, expect, it } from "vitest";
import {
  databaseTargetFromUrl,
  isDatabaseTargetConfirmed,
} from "../databaseTarget.js";

describe("databaseTargetFromUrl", () => {
  it("returns a target identity without exposing connection credentials", () => {
    const target = databaseTargetFromUrl(
      "postgresql://operator:do-not-print@127.0.0.1:55432/cloudvault_integration_test?schema=public",
    );

    expect(target).toBe("127.0.0.1:55432/cloudvault_integration_test");
    expect(target).not.toContain("operator");
    expect(target).not.toContain("do-not-print");
  });

  it("uses PostgreSQL's default port when one is omitted", () => {
    expect(
      databaseTargetFromUrl("postgres://operator:secret@db.example.test/cloudvault"),
    ).toBe("db.example.test:5432/cloudvault");
  });

  it("rejects malformed or non-PostgreSQL connection strings", () => {
    expect(() => databaseTargetFromUrl("not a URL")).toThrow(
      "DATABASE_URL is invalid",
    );
    expect(() => databaseTargetFromUrl("mysql://db.example.test/cloudvault")).toThrow(
      "DATABASE_URL must use PostgreSQL",
    );
  });

  it("requires operators to confirm the exact database target", () => {
    const url = "postgresql://operator:secret@127.0.0.1:55432/cloudvault_integration_test";
    expect(
      isDatabaseTargetConfirmed(
        url,
        "127.0.0.1:55432/cloudvault_integration_test",
      ),
    ).toBe(true);
    expect(
      isDatabaseTargetConfirmed(url, "127.0.0.1:5432/cloudvault"),
    ).toBe(false);
    expect(isDatabaseTargetConfirmed(url, undefined)).toBe(false);
  });
});
