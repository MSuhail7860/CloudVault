-- Add a durable account lifecycle marker so deletion can be retried safely.
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'PENDING_DELETION');

ALTER TABLE "User"
ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);

CREATE INDEX "User_accountStatus_idx" ON "User"("accountStatus");
