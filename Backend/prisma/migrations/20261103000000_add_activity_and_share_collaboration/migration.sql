-- AlterTable
ALTER TABLE "File" ADD COLUMN "processingStatus" TEXT DEFAULT 'COMPLETED',
ADD COLUMN "metadata" JSONB;

-- AlterTable
ALTER TABLE "ShareLink" ADD COLUMN "permission" TEXT NOT NULL DEFAULT 'VIEW',
ADD COLUMN "sharedWithEmail" TEXT,
ADD COLUMN "sharedWithId" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceName" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareLink_sharedWithId_idx" ON "ShareLink"("sharedWithId");

-- CreateIndex
CREATE INDEX "ShareLink_sharedWithEmail_idx" ON "ShareLink"("sharedWithEmail");

-- CreateIndex
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_resourceId_idx" ON "Activity"("resourceId");

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

