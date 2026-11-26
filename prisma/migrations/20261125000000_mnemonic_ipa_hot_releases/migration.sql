-- Add IPA, 邪修记忆 mnemonic JSON on Card & DailyTaskWord, and AppRelease hot-update push table.

ALTER TABLE "Card" ADD COLUMN "ipa" TEXT;
ALTER TABLE "Card" ADD COLUMN "mnemonic" JSONB;

ALTER TABLE "DailyTaskWord" ADD COLUMN "ipa" TEXT;
ALTER TABLE "DailyTaskWord" ADD COLUMN "mnemonic" JSONB;

CREATE TYPE "ReleasePushMode" AS ENUM ('BANNER', 'FORCE_RELOAD', 'SILENT');
CREATE TYPE "ReleasePayloadType" AS ENUM ('APP_UI', 'VOCAB_PACK', 'MNEMONIC_PATCH');

CREATE TABLE "app_releases" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "pack_version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "push_mode" "ReleasePushMode" NOT NULL DEFAULT 'BANNER',
    "payload_type" "ReleasePayloadType" NOT NULL DEFAULT 'VOCAB_PACK',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "published_by" TEXT NOT NULL,
    "publisher_role" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_releases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "app_releases_is_active_published_at_idx" ON "app_releases"("is_active", "published_at");
