-- Accepted alternative spellings for spelling judgement (§6.1).
ALTER TABLE "Card" ADD COLUMN "variants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];