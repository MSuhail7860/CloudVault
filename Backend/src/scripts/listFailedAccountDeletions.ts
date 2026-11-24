import "dotenv/config";

import { prisma } from "../config/database.js";
import { listFailedAccountDeletions } from "../services/accountDeletionService.js";
import {
  databaseTargetFromUrl,
  isDatabaseTargetConfirmed,
} from "../utils/databaseTarget.js";

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const databaseUrl = process.env.DATABASE_URL;
const confirmation = readOption("--confirm-database");
let databaseTarget = "";

try {
  if (databaseUrl) databaseTarget = databaseTargetFromUrl(databaseUrl);
} catch {
  databaseTarget = "";
}

if (
  !databaseTarget ||
  !databaseUrl ||
  !isDatabaseTargetConfirmed(databaseUrl, confirmation)
) {
  console.error(
    "Usage: npm run account-deletion:list-failed -- --confirm-database <host:port/database>",
  );
  if (databaseTarget) {
    console.error(`Expected database target: ${databaseTarget}`);
  }
  process.exitCode = 2;
  await prisma.$disconnect();
} else {
  try {
    const tasks = await listFailedAccountDeletions();
    console.log(JSON.stringify(tasks, null, 2));
  } catch {
    console.error("Could not list failed account-deletion tasks.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
