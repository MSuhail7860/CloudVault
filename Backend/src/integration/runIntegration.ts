import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { readIntegrationEnvironment, toChildEnvironment } from "./integrationEnvironment.js";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const run = (command: string, args: string[], env: NodeJS.ProcessEnv): void => {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: backendRoot,
    env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

try {
  const envFile = resolve(backendRoot, ".env.integration");
  const envResult = config({ path: envFile, override: false });
  if (
    envResult.error &&
    (envResult.error as NodeJS.ErrnoException).code !== "ENOENT"
  ) {
    throw new Error("Could not load the integration environment file");
  }

  const environment = readIntegrationEnvironment();
  const childEnvironment = toChildEnvironment(environment);

  delete process.env.DATABASE_URL_UNPOOLED;
  Object.assign(process.env, childEnvironment);
  const { validateStorageVersioning } = await import(
    "../services/storageService.js"
  );
  await validateStorageVersioning({ requireConfigured: true });

  run(
    resolve("node_modules/prisma/build/index.js"),
    ["migrate", "deploy"],
    childEnvironment,
  );
  run(
    resolve("node_modules/vitest/vitest.mjs"),
    ["run", "src/integration"],
    childEnvironment,
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Integration test setup failed",
  );
  process.exitCode = 1;
}
