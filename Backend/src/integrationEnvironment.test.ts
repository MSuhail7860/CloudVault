import { afterEach, describe, expect, it } from "vitest";
import {
  readIntegrationEnvironment,
  toChildEnvironment,
} from "./integration/integrationEnvironment.js";

const variableNames = [
  "INTEGRATION_DATABASE_URL",
  "INTEGRATION_REDIS_URL",
  "INTEGRATION_S3_ENDPOINT",
  "INTEGRATION_S3_REGION",
  "INTEGRATION_S3_BUCKET",
  "INTEGRATION_S3_ACCESS_KEY_ID",
  "INTEGRATION_S3_SECRET_ACCESS_KEY",
  "INTEGRATION_ALLOW_REMOTE",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
] as const;

const originalEnvironment = new Map(
  variableNames.map((name) => [name, process.env[name]]),
);

const setSafeEnvironment = (): void => {
  process.env.INTEGRATION_DATABASE_URL =
    "postgresql://test:test@127.0.0.1:55432/cloudvault_integration_test";
  process.env.INTEGRATION_REDIS_URL = "redis://127.0.0.1:56379/15";
  process.env.INTEGRATION_S3_ENDPOINT = "http://127.0.0.1:59000";
  process.env.INTEGRATION_S3_REGION = "us-east-1";
  process.env.INTEGRATION_S3_BUCKET = "cloudvault-integration-test";
  process.env.INTEGRATION_S3_ACCESS_KEY_ID = "test-access-key";
  process.env.INTEGRATION_S3_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.INTEGRATION_ALLOW_REMOTE = "false";
  process.env.JWT_ACCESS_SECRET = "a".repeat(32);
  process.env.JWT_REFRESH_SECRET = "b".repeat(32);
};

afterEach(() => {
  for (const name of variableNames) {
    const value = originalEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("integration environment validation", () => {
  it("accepts only the dedicated local service configuration", () => {
    setSafeEnvironment();

    expect(readIntegrationEnvironment()).toMatchObject({
      redisUrl: "redis://127.0.0.1:56379/15",
      s3Endpoint: "http://127.0.0.1:59000",
      s3Region: "us-east-1",
      s3Bucket: "cloudvault-integration-test",
    });
  });

  it("rejects a database other than the isolated test database and port", () => {
    setSafeEnvironment();
    process.env.INTEGRATION_DATABASE_URL =
      "postgresql://test:test@127.0.0.1:5432/cloudvault_integration_test";

    expect(() => readIntegrationEnvironment()).toThrow(
      "INTEGRATION_DATABASE_URL must target cloudvault_integration_test on 127.0.0.1:55432",
    );
  });

  it("rejects a Redis database or endpoint outside the isolated service", () => {
    setSafeEnvironment();
    process.env.INTEGRATION_REDIS_URL = "redis://127.0.0.1:56379/0";

    expect(() => readIntegrationEnvironment()).toThrow(
      "INTEGRATION_REDIS_URL must target Redis database 15 on 127.0.0.1:56379",
    );
  });

  it("rejects unexpected storage endpoints, regions, or buckets", () => {
    setSafeEnvironment();
    process.env.INTEGRATION_S3_ENDPOINT = "https://storage.example";
    expect(() => readIntegrationEnvironment()).toThrow(
      "INTEGRATION_S3_ENDPOINT must target http://127.0.0.1:59000 without embedded credentials",
    );

    setSafeEnvironment();
    process.env.INTEGRATION_S3_REGION = "us-west-2";
    expect(() => readIntegrationEnvironment()).toThrow(
      "INTEGRATION_S3_REGION must be us-east-1",
    );

    setSafeEnvironment();
    process.env.INTEGRATION_S3_BUCKET = "cloudvault-files";
    expect(() => readIntegrationEnvironment()).toThrow(
      "INTEGRATION_S3_BUCKET must be cloudvault-integration-test",
    );
  });

  it("does not allow remote services even when explicitly requested", () => {
    setSafeEnvironment();
    process.env.INTEGRATION_ALLOW_REMOTE = "true";

    expect(() => readIntegrationEnvironment()).toThrow(
      "Remote integration services are not permitted",
    );
  });

  it("requires distinct, strong local JWT secrets before integration setup", () => {
    setSafeEnvironment();
    process.env.JWT_REFRESH_SECRET = process.env.JWT_ACCESS_SECRET;

    expect(() => readIntegrationEnvironment()).toThrow(
      "Integration JWT secrets must be distinct values of at least 32 characters",
    );
  });

  it("passes only validated values to subprocesses and disables remote access", () => {
    setSafeEnvironment();
    const childEnvironment = toChildEnvironment(readIntegrationEnvironment());

    expect(childEnvironment.DATABASE_URL).toBe(
      process.env.INTEGRATION_DATABASE_URL,
    );
    expect(childEnvironment.REDIS_URL).toBe(process.env.INTEGRATION_REDIS_URL);
    expect(childEnvironment.S3_ENDPOINT).toBe(
      process.env.INTEGRATION_S3_ENDPOINT,
    );
    expect(childEnvironment.INTEGRATION_ALLOW_REMOTE).toBe("false");
  });
});
