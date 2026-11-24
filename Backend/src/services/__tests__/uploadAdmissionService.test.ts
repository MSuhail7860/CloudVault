import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;
const mocks = vi.hoisted(() => ({
  eval: vi.fn(),
  redis: null as null | { eval: typeof vi.fn },
}));

vi.mock("../../config/redis.js", () => ({
  getRedisClient: () => mocks.redis,
}));

import { acquireUploadPermit } from "../uploadAdmissionService.js";

const sortedSets = new Map<string, Map<string, number>>();
let now = 1_000_000;

const executeScript = async (...args: unknown[]): Promise<number> => {
  const script = String(args[0]);
  const numKeys = Number(args[1]);
  const keys = args.slice(2, 2 + numKeys).map(String);
  const argv = args.slice(2 + numKeys).map(String);

  if (script.includes('return redis.call("ZREM"')) {
    return sortedSets.get(keys[0]!)?.delete(argv[0]!) ? 1 : 0;
  }

  const [leaseKey, rateKey] = keys;
  const timestamp = Number(argv[0]);
  const permitId = argv[1]!;
  const [permitTtl, rateWindow, concurrencyLimit, rateLimit] = argv
    .slice(2)
    .map(Number);
  const leases = sortedSets.get(leaseKey!) ?? new Map<string, number>();
  const requests = sortedSets.get(rateKey!) ?? new Map<string, number>();
  for (const [member, expiration] of leases) {
    if (expiration <= timestamp) leases.delete(member);
  }
  for (const [member, time] of requests) {
    if (time <= timestamp - rateWindow!) requests.delete(member);
  }
  sortedSets.set(leaseKey!, leases);
  sortedSets.set(rateKey!, requests);

  if (leases.size >= concurrencyLimit!) return 1;
  if (requests.size >= rateLimit!) return 2;
  leases.set(permitId, timestamp + permitTtl!);
  requests.set(permitId, timestamp);
  return 0;
};

beforeEach(() => {
  vi.clearAllMocks();
  sortedSets.clear();
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  mocks.eval.mockImplementation(executeScript);
  mocks.redis = { eval: mocks.eval };
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("distributed upload admission", () => {
  it("enforces concurrency across independent API instances", async () => {
    const [first, second] = await Promise.all([
      acquireUploadPermit("shared-user"),
      acquireUploadPermit("shared-user"),
    ]);
    const third = await acquireUploadPermit("shared-user");

    expect(first.status).toBe("ADMITTED");
    expect(second.status).toBe("ADMITTED");
    expect(third.status).toBe("CONCURRENCY_LIMIT");
  });

  it("expires abandoned permits so a crashed instance cannot block uploads", async () => {
    const first = await acquireUploadPermit("expired-user");
    const second = await acquireUploadPermit("expired-user");
    expect(first.status).toBe("ADMITTED");
    expect(second.status).toBe("ADMITTED");

    now += 3 * 60 * 1000 + 1;
    const afterExpiry = await acquireUploadPermit("expired-user");
    expect(afterExpiry.status).toBe("ADMITTED");
  });

  it("makes release idempotent and removes only its own request permit", async () => {
    const first = await acquireUploadPermit("release-user");
    const second = await acquireUploadPermit("release-user");
    expect(first.permit).toBeDefined();
    expect(second.permit).toBeDefined();

    await first.permit!.release();
    await first.permit!.release();
    const third = await acquireUploadPermit("release-user");

    expect(mocks.eval.mock.calls.filter(([script]) =>
      String(script).includes('return redis.call("ZREM"'),
    )).toHaveLength(1);
    expect(third.status).toBe("ADMITTED");
  });

  it("enforces the rolling request rate across instances", async () => {
    for (let index = 0; index < 30; index += 1) {
      const admission = await acquireUploadPermit("rate-user");
      expect(admission.status).toBe("ADMITTED");
      await admission.permit!.release();
    }

    const limited = await acquireUploadPermit("rate-user");
    expect(limited.status).toBe("RATE_LIMIT");
  });

  it("fails closed in production when Redis is unavailable", async () => {
    mocks.redis = null;
    process.env.NODE_ENV = "production";

    await expect(acquireUploadPermit("production-user")).rejects.toThrow(
      "Distributed upload admission is unavailable",
    );
  });

  it("fails closed when the Redis admission operation errors", async () => {
    process.env.NODE_ENV = "production";
    mocks.eval.mockRejectedValueOnce(new Error("Redis connection secret"));

    await expect(acquireUploadPermit("redis-error-user")).rejects.toThrow(
      "Distributed upload admission is unavailable",
    );
  });

  it("uses a bounded local limiter in development when Redis errors", async () => {
    process.env.NODE_ENV = "development";
    mocks.eval.mockRejectedValueOnce(new Error("Redis connection detail"));

    await expect(acquireUploadPermit("dev-fallback-user")).resolves.toMatchObject({
      status: "ADMITTED",
    });
  });

  it("permits deterministic local development admission when Redis is disabled", async () => {
    mocks.redis = null;
    process.env.NODE_ENV = "development";

    const first = await acquireUploadPermit("local-user");
    const second = await acquireUploadPermit("local-user");
    const third = await acquireUploadPermit("local-user");

    expect(first.status).toBe("ADMITTED");
    expect(second.status).toBe("ADMITTED");
    expect(third.status).toBe("CONCURRENCY_LIMIT");
  });
});
