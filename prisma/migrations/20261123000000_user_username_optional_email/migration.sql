-- Add username login identity and make email optional for students.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- Backfill existing accounts so the unique index can be created. The short id
-- suffix keeps collisions impossible without needing an interactive merge.
UPDATE "User"
SET "username" = lower(regexp_replace(split_part("email", '@', 1), '[^a-zA-Z0-9_]', '_'))
                 || '_' || substring("id"::text, 1, 4)
WHERE "username" IS NULL;

-- Trim / collapse characters that are not valid username characters after the
-- backfill. The id suffix above guarantees uniqueness, so this only improves
-- readability and must not be relied on for uniqueness.
UPDATE "User"
SET "username" = lower(trim(both '_' from regexp_replace("username", '[_]{2,}', '_')))
WHERE "username" IS NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
