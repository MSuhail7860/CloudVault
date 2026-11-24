-- Persist deletion work independently of Redis/BullMQ so pending accounts are
-- recoverable after queue outages and process restarts.
CREATE TYPE "AccountDeletionTaskStatus" AS ENUM ('PENDING', 'PROCESSING');

CREATE TABLE "AccountDeletionTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountDeletionTaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletionTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDeletionTask_userId_key" ON "AccountDeletionTask"("userId");
CREATE INDEX "AccountDeletionTask_status_nextAttemptAt_idx" ON "AccountDeletionTask"("status", "nextAttemptAt");

ALTER TABLE "AccountDeletionTask"
ADD CONSTRAINT "AccountDeletionTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
