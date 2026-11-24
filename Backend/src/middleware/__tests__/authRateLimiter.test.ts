import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Request } from "express";
import {
  getAuthRateLimitKey,
  isTestIsolationAllowed,
} from "../authRateLimiter.js";

describe("authRateLimiter key generation and isolation", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowIsolation = process.env.ALLOW_TEST_CLIENT_ISOLATION;

  beforeEach(() => {
    delete process.env.ALLOW_TEST_CLIENT_ISOLATION;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowIsolation !== undefined) {
      process.env.ALLOW_TEST_CLIENT_ISOLATION = originalAllowIsolation;
    } else {
      delete process.env.ALLOW_TEST_CLIENT_ISOLATION;
    }
  });

  it("never allows test client isolation in production", () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_TEST_CLIENT_ISOLATION = "true";

    expect(isTestIsolationAllowed()).toBe(false);

    const mockReq = {
      ip: "203.0.113.195",
      headers: { "x-test-client-id": "test-client-12345" },
    } as unknown as Request;

    expect(getAuthRateLimitKey(mockReq)).toBe("203.0.113.195");
  });

  it("disallows test client isolation by default in non-production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.ALLOW_TEST_CLIENT_ISOLATION;

    expect(isTestIsolationAllowed()).toBe(false);

    const mockReq = {
      ip: "127.0.0.1",
      headers: { "x-test-client-id": "test-client-12345" },
    } as unknown as Request;

    expect(getAuthRateLimitKey(mockReq)).toBe("127.0.0.1");
  });

  it("isolates rate limit key when ALLOW_TEST_CLIENT_ISOLATION is true in non-production", () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_TEST_CLIENT_ISOLATION = "true";

    expect(isTestIsolationAllowed()).toBe(true);

    const mockReq = {
      ip: "127.0.0.1",
      headers: { "x-test-client-id": "valid-test-client-id-123" },
    } as unknown as Request;

    expect(getAuthRateLimitKey(mockReq)).toBe(
      "127.0.0.1:valid-test-client-id-123",
    );
  });

  it("falls back to ip when x-test-client-id header is invalid format", () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_TEST_CLIENT_ISOLATION = "true";

    const mockReq = {
      ip: "127.0.0.1",
      headers: { "x-test-client-id": "short" },
    } as unknown as Request;

    expect(getAuthRateLimitKey(mockReq)).toBe("127.0.0.1");
  });

  it("falls back to ip when x-test-client-id header is missing", () => {
    process.env.NODE_ENV = "development";
    process.env.ALLOW_TEST_CLIENT_ISOLATION = "true";

    const mockReq = {
      ip: "127.0.0.1",
      headers: {},
    } as unknown as Request;

    expect(getAuthRateLimitKey(mockReq)).toBe("127.0.0.1");
  });
});

