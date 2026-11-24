import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  readIntegrationEnvironment,
  toChildEnvironment,
} from "./integrationEnvironment.js";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = resolve(backendRoot, "..");
const frontendRoot = resolve(repositoryRoot, "Frontend");

const runCommand = (command: string, args: string[], env: NodeJS.ProcessEnv) => {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: backendRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("An isolated browser-test prerequisite failed");
  }
};

const startProcess = (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcess =>
  spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });

const waitForUrl = async (url: string, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("A browser-test application server stopped unexpectedly");
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      continue;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("A browser-test application server did not become ready");
};

const stopProcess = async (child: ChildProcess | undefined): Promise<void> => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let killTimer: NodeJS.Timeout | undefined;
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())),
    new Promise<void>((resolvePromise) => {
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise();
      }, 5_000);
    }),
  ]);
  if (killTimer) clearTimeout(killTimer);
};

let apiProcess: ChildProcess | undefined;
let frontendProcess: ChildProcess | undefined;
let mailDirectory: string | undefined;

try {
  const loaded = config({
    path: resolve(backendRoot, ".env.integration"),
    override: false,
  });
  if (
    loaded.error &&
    (loaded.error as NodeJS.ErrnoException).code !== "ENOENT"
  ) {
    throw new Error("Could not load isolated browser-test configuration");
  }

  const integrationEnvironment = readIntegrationEnvironment();
  const childEnvironment = toChildEnvironment(integrationEnvironment);
  Object.assign(process.env, childEnvironment);

  const { validateStorageVersioning } = await import(
    "../services/storageService.js"
  );
  await validateStorageVersioning({ requireConfigured: true });

  runCommand(
    resolve(backendRoot, "node_modules/prisma/build/index.js"),
    ["migrate", "deploy"],
    childEnvironment,
  );

  mailDirectory = await mkdtemp(resolve(backendRoot, ".mail-capture-e2e-"));
  const applicationEnvironment: NodeJS.ProcessEnv = {
    ...childEnvironment,
    NODE_ENV: "development",
    PORT: "8000",
    FRONTEND_URL: "http://127.0.0.1:3000",
    EMAIL_CAPTURE_DIRECTORY: mailDirectory,
    ALLOW_TEST_CLIENT_ISOLATION: "true",
  };
  const frontendEnvironment: NodeJS.ProcessEnv = {
    ...applicationEnvironment,
    VITE_API_BASE_URL: "http://127.0.0.1:8000/api/v1",
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3000",
    E2E_API_BASE_URL: "http://127.0.0.1:8000/api/v1",
    E2E_MAIL_CAPTURE_DIRECTORY: mailDirectory,
  };

  apiProcess = startProcess(
    process.execPath,
    [resolve(backendRoot, "node_modules/tsx/dist/cli.mjs"), "src/server.ts"],
    backendRoot,
    applicationEnvironment,
  );
  frontendProcess = startProcess(
    process.execPath,
    [
      resolve(frontendRoot, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "3000",
      "--strictPort",
    ],
    frontendRoot,
    frontendEnvironment,
  );

  await Promise.all([
    waitForUrl("http://127.0.0.1:8000/", apiProcess),
    waitForUrl("http://127.0.0.1:3000/", frontendProcess),
  ]);

  runCommand(
    resolve(frontendRoot, "node_modules/@playwright/test/cli.js"),
    ["test", `--config=${resolve(frontendRoot, "playwright.config.ts")}`],
    frontendEnvironment,
  );
} catch (error) {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error(
    JSON.stringify({
      event: "isolated_browser_e2e_failed",
      errorName,
    }),
  );
  process.exitCode = 1;
} finally {
  await Promise.all([
    stopProcess(apiProcess),
    stopProcess(frontendProcess),
  ]);
  if (mailDirectory) {
    await rm(mailDirectory, { recursive: true, force: true });
  }
}
