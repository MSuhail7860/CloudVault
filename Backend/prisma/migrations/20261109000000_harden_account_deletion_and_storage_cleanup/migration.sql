-- Add claim ownership so expired workers cannot mutate a newer deletion attempt.
ALTER TABLE "AccountDeletionTask"
ADD COLUMN "claimToken" TEXT;

CREATE UNIQUE INDEX "AccountDeletionTask_claimToken_key"
ON "AccountDeletionTask"("claimToken");

CREATE TYPE "StorageObjectTaskStatus" AS ENUM ('UPLOADING', 'PENDING_CLEANUP', 'PROCESSING');

-- A reservation is created before an object is uploaded. It is deleted in the
-- same transaction as the file/version row, or retained as durable cleanup
-- work when that transaction cannot commit.
CREATE TABLE "StorageObjectTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "StorageObjectTaskStatus" NOT NULL DEFAULT 'UPLOADING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "claimToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageObjectTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorageObjectTask_storageKey_key"
ON "StorageObjectTask"("storageKey");
CREATE UNIQUE INDEX "StorageObjectTask_claimToken_key"
ON "StorageObjectTask"("claimToken");
CREATE INDEX "StorageObjectTask_userId_status_nextAttemptAt_idx"
ON "StorageObjectTask"("userId", "status", "nextAttemptAt");
CREATE INDEX "StorageObjectTask_status_nextAttemptAt_idx"
ON "StorageObjectTask"("status", "nextAttemptAt");

ALTER TABLE "StorageObjectTask"
ADD CONSTRAINT "StorageObjectTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
