-- Presentation-only world content releases. Keep independent of Stage 3/4 migrations.
ALTER TYPE "ReleasePayloadType" ADD VALUE IF NOT EXISTS 'WORLD_CONTENT';
