-- Session revocation generation. Tokens carry the version they were issued
-- under; password changes/resets bump it and invalidate older refresh tokens.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;