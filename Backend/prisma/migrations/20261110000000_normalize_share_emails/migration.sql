-- Normalize legacy recipient email values so account deletion and incoming-share
-- lookup use the same representation as current share creation.
-- ShareLink.sharedWithEmail has no unique constraint, so normalization cannot
-- collapse or discard duplicate shares. This data cleanup is intentionally not
-- reversible because the original whitespace/casing is not security-relevant.
UPDATE "ShareLink"
SET "sharedWithEmail" = LOWER(BTRIM("sharedWithEmail")),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "sharedWithEmail" IS NOT NULL
  AND BTRIM("sharedWithEmail") <> '';
