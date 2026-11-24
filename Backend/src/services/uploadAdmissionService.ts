import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { getRedisClient } from "../config/redis.js";

const CONCURRENCY_LIMIT = 2;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const PERMIT_TTL_MS = 3 * 60 * 1000;
const REDIS_COMMAND_TIMEOUT_MS = 2_000;

// A single Lua transaction prunes expired leases, enforces both limits, and
// grants a request-unique lease; release removes only that request's member.
const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local permitTtl = tonumber(ARGV[3])
local rateWindow = tonumber(ARGV[4])
local concurrencyLimit = tonumber(ARGV[5])
local rateLimit = tonumber(ARGV[6])

redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
if redis.call("ZCARD", KEYS[1]) >= concurrencyLimit then
  return 1
end

redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now - rateWindow)
if redis.call("ZCARD", KEYS[2]) >= rateLimit then
  return 2
end

redis.call("ZADD", KEYS[1], now + permitTtl, member)
redis.call("PEXPIRE", KEYS[1], permitTtl)
redis.call("ZADD", KEYS[2], now, member)
redis.call("PEXPIRE", KEYS[2], rateWindow)
return 0
`;

const RELEASE_SCRIPT = `
return redis.call("ZREM", KEYS[1], ARGV[1])
`;

type AdmissionStatus = "ADMITTED" | "CONCURRENCY_LIMIT" | "RATE_LIMIT";

export interface UploadPermit {
  release(): Promise<void>;
}

interface LocalState {
  permits: Map<string, number>;
  requests: number[];
  cleanupTimer?: NodeJS.Timeout;
}

const localState = new Map<string, LocalState>();

const getLocalState = (userId: string): LocalState => {
  let state = localState.get(userId);
  if (!state) {
    state = { permits: new Map(), requests: [] };
    localState.set(userId, state);
  }
  return state;
};

const acquireLocally = (userId: string): {
  status: AdmissionStatus;
  permit?: UploadPermit;
} => {
  const now = Date.now();
  const state = getLocalState(userId);
  if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
  for (const [permitId, expiresAt] of state.permits) {
    if (expiresAt <= now) state.permits.delete(permitId);
  }
  state.requests = state.requests.filter(
    (timestamp) => timestamp > now - RATE_WINDOW_MS,
  );
  if (state.permits.size >= CONCURRENCY_LIMIT) {
    return { status: "CONCURRENCY_LIMIT" };
  }
  if (state.requests.length >= RATE_LIMIT) return { status: "RATE_LIMIT" };

  const permitId = randomUUID();
  state.permits.set(permitId, now + PERMIT_TTL_MS);
  state.requests.push(now);
  state.cleanupTimer = setTimeout(() => {
    if (localState.get(userId) === state) localState.delete(userId);
  }, RATE_WINDOW_MS + 1);
  state.cleanupTimer.unref();
  let released = false;
  return {
    status: "ADMITTED",
    permit: {
      async release() {
        if (released) return;
        released = true;
        state.permits.delete(permitId);
      },
    },
  };
};

const withCommandTimeout = async <T>(operation: Promise<T>): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Upload admission command timed out")),
          REDIS_COMMAND_TIMEOUT_MS,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const acquireFromRedis = async (
  redis: Redis,
  userId: string,
): Promise<{ status: AdmissionStatus; permit?: UploadPermit }> => {
  const permitId = randomUUID();
  const keyPrefix = `cloudvault:upload:{${userId}}`;
  const leaseKey = `${keyPrefix}:leases`;
  const rateKey = `${keyPrefix}:rate`;
  const status = Number(
    await withCommandTimeout(
      redis.eval(
        ACQUIRE_SCRIPT,
        2,
        leaseKey,
        rateKey,
        String(Date.now()),
        permitId,
        String(PERMIT_TTL_MS),
        String(RATE_WINDOW_MS),
        String(CONCURRENCY_LIMIT),
        String(RATE_LIMIT),
      ) as Promise<number>,
    ),
  );

  if (status === 1) return { status: "CONCURRENCY_LIMIT" };
  if (status === 2) return { status: "RATE_LIMIT" };

  let released = false;
  return {
    status: "ADMITTED",
    permit: {
      async release() {
        if (released) return;
        released = true;
        await withCommandTimeout(
          redis.eval(RELEASE_SCRIPT, 1, leaseKey, permitId) as Promise<number>,
        );
      },
    },
  };
};

export const acquireUploadPermit = async (
  userId: string,
): Promise<{ status: AdmissionStatus; permit?: UploadPermit }> => {
  const redis = getRedisClient();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Distributed upload admission is unavailable");
    }
    return acquireLocally(userId);
  }

  try {
    return await acquireFromRedis(redis, userId);
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Distributed upload admission is unavailable");
    }
    return acquireLocally(userId);
  }
};
