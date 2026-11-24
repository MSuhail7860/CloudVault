import "dotenv/config";
import { validateStorageVersioning } from "../services/storageService.js";

try {
  const status = await validateStorageVersioning({ requireConfigured: true });
  console.log(`Object-storage versioning preflight passed: ${status}`);
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Object-storage versioning preflight failed",
  );
  process.exitCode = 1;
}
