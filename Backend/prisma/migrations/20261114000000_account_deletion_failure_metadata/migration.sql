ALTER TABLE "AccountDeletionTask"
ADD COLUMN "lastFailureCode" TEXT,
ADD COLUMN "lastFailureAt" TIMESTAMP(3),
ADD COLUMN "failedAt" TIMESTAMP(3);
