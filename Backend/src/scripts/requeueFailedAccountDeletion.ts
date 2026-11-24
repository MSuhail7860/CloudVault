import "dotenv/config";

import { prisma } from "../config/database.js";
import { requeueFailedAccountDeletion } from "../services/accountDeletionService.js";
import {
  databaseTargetFromUrl,
  isDatabaseTargetConfirmed,
} from "../utils/databaseTarget.js";

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const userId = readOption("--user-id");
const confirmation = readOption("--confirm-user-id");
const databaseUrl = process.env.DATABASE_URL;
const databaseConfirmation = readOption("--confirm-database");
let databaseTarget = "";

try {
  if (databaseUrl) databaseTarget = databaseTargetFromUrl(databaseUrl);
} catch {
  databaseTarget = "";
}

if (
  !userId ||
  !confirmation ||
  userId !== confirmation ||
  !databaseTarget ||
  !databaseUrl ||
  !isDatabaseTargetConfirmed(databaseUrl, databaseConfirmation) ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    userId,
  )
) {
  console.error(
    "Usage: npm run account-deletion:requeue -- --user-id <uuid> --confirm-user-id <same-uuid> --confirm-database <host:port/database>",
  );
  if (databaseTarget && databaseConfirmation !== databaseTarget) {
    console.error(`Expected database target: ${databaseTarget}`);
  }
  process.exitCode = 2;
} else {
  try {
    await requeueFailedAccountDeletion(userId);
    console.log("Failed account-deletion task requeued.");
  } catch {
    console.error("Could not requeue the account-deletion task.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
