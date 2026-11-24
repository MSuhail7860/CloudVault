const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for integration tests`);
  return value;
};

const assertSafeDatabaseUrl = (value: string): void => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("INTEGRATION_DATABASE_URL is not a valid PostgreSQL URL");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    databaseName !== "cloudvault_integration_test" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432"
  ) {
    throw new Error(
      "INTEGRATION_DATABASE_URL must target cloudvault_integration_test on 127.0.0.1:55432",
    );
  }
};

const assertSafeRedisUrl = (value: string): void => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("INTEGRATION_REDIS_URL is not a valid Redis URL");
  }

  if (
    url.protocol !== "redis:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "56379" ||
    url.pathname !== "/15"
  ) {
    throw new Error(
      "INTEGRATION_REDIS_URL must target Redis database 15 on 127.0.0.1:56379",
    );
  }
};

const assertSafeBucket = (bucket: string): void => {
  if (bucket !== "cloudvault-integration-test") {
    throw new Error(
      "INTEGRATION_S3_BUCKET must be cloudvault-integration-test",
    );
  }
};

const assertSafeS3Endpoint = (value: string): void => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("INTEGRATION_S3_ENDPOINT is not a valid URL");
  }

  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "59000" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "INTEGRATION_S3_ENDPOINT must target http://127.0.0.1:59000 without embedded credentials",
    );
  }
};

const assertRemoteAccessDisabled = (): void => {
  const setting = process.env.INTEGRATION_ALLOW_REMOTE?.trim().toLowerCase();
  if (setting !== undefined && setting !== "false") {
    throw new Error("Remote integration services are not permitted");
  }
};

export interface IntegrationEnvironment {
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
}

export const readIntegrationEnvironment = (): IntegrationEnvironment => {
  assertRemoteAccessDisabled();

  const accessSecret = required("JWT_ACCESS_SECRET");
  const refreshSecret = required("JWT_REFRESH_SECRET");
  if (
    accessSecret.length < 32 ||
    refreshSecret.length < 32 ||
    accessSecret === refreshSecret
  ) {
    throw new Error(
      "Integration JWT secrets must be distinct values of at least 32 characters",
    );
  }

  const databaseUrl = required("INTEGRATION_DATABASE_URL");
  const redisUrl = required("INTEGRATION_REDIS_URL");
  const s3Endpoint = required("INTEGRATION_S3_ENDPOINT");
  const s3Region = required("INTEGRATION_S3_REGION");
  const s3Bucket = required("INTEGRATION_S3_BUCKET");
  const s3AccessKeyId = required("INTEGRATION_S3_ACCESS_KEY_ID");
  const s3SecretAccessKey = required("INTEGRATION_S3_SECRET_ACCESS_KEY");

  assertSafeDatabaseUrl(databaseUrl);
  assertSafeRedisUrl(redisUrl);
  assertSafeS3Endpoint(s3Endpoint);
  assertSafeBucket(s3Bucket);
  if (s3Region !== "us-east-1") {
    throw new Error("INTEGRATION_S3_REGION must be us-east-1");
  }

  return {
    databaseUrl,
    redisUrl,
    s3Endpoint,
    s3Region,
    s3Bucket,
    s3AccessKeyId,
    s3SecretAccessKey,
  };
};

export const toChildEnvironment = (
  environment: IntegrationEnvironment,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: environment.databaseUrl,
    REDIS_ENABLED: "true",
    REDIS_URL: environment.redisUrl,
    S3_ENDPOINT: environment.s3Endpoint,
    S3_REGION: environment.s3Region,
    S3_BUCKET: environment.s3Bucket,
    S3_ACCESS_KEY_ID: environment.s3AccessKeyId,
    S3_SECRET_ACCESS_KEY: environment.s3SecretAccessKey,
    INTEGRATION_ALLOW_REMOTE: "false",
  };
  delete env.DATABASE_URL_UNPOOLED;
  return env;
};
