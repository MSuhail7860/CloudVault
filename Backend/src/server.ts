import "dotenv/config";
import app from "./app.js";
import { closeRedisConnection } from "./config/redis.js";
import { prisma } from "./config/database.js";
import { closeQueues } from "./jobs/queues.js";
import { startAccountDeletionRecovery } from "./jobs/accountDeletionRecovery.js";
import { assertEmailDeliveryConfiguration } from "./services/emailService.js";

const PORT = Number(process.env.PORT) || 8000;

assertEmailDeliveryConfiguration();
const recoveryTimer = startAccountDeletionRecovery();

const server = app.listen(PORT, () => {
  console.log(`CloudVault API running on port ${PORT}`);
});

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(recoveryTimer);
  console.log(`[API] Received ${signal}; shutting down gracefully.`);

  const forceTimer = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 30_000);
  forceTimer.unref();

  server.close((serverError) => {
    void (async () => {
      try {
        if (serverError) throw serverError;
        await closeQueues();
        await closeRedisConnection();
        await prisma.$disconnect();
        console.log("[API] Shutdown completed.");
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "api_shutdown_failed",
            errorName: error instanceof Error ? error.name : "UnknownError",
          }),
        );
        process.exitCode = 1;
      } finally {
        clearTimeout(forceTimer);
      }
    })();
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
