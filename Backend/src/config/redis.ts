import { Redis, type RedisOptions } from "ioredis";

let redisClient: Redis | null = null;
let isConnected = false;

const getRedisConfig = (): RedisOptions => {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    return {
      lazyConnect: true,
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    };
  }

  return {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
};

export const getRedisClient = (): Redis | null => {
  if (redisClient) {
    return redisClient;
  }

  // If REDIS_ENABLED is explicitly set to false, do not attempt connection
  if (process.env.REDIS_ENABLED === "false") {
    return null;
  }

  try {
    const config = getRedisConfig();
    const redisUrl = process.env.REDIS_URL;

    redisClient = redisUrl ? new Redis(redisUrl, config) : new Redis(config);

    redisClient.on("connect", () => {
      isConnected = true;
      console.log("[Redis] Connected successfully.");
    });

    redisClient.on("ready", () => {
      isConnected = true;
      console.log("[Redis] Ready to accept commands.");
    });

    redisClient.on("error", (error) => {
      isConnected = false;
      // Do not crash the application if Redis connection fails
      console.warn(`[Redis] Connection warning: ${error.message}`);
    });

    redisClient.on("close", () => {
      isConnected = false;
      console.log("[Redis] Connection closed.");
    });

    return redisClient;
  } catch (error) {
    console.warn("[Redis] Failed to initialize client:", error);
    redisClient = null;
    return null;
  }
};

export const isRedisAvailable = (): boolean => isConnected;

export const closeRedisConnection = async (): Promise<void> => {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    } finally {
      redisClient = null;
      isConnected = false;
      console.log("[Redis] Disconnected gracefully.");
    }
  }
};

