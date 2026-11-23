-- Persist the ordered session queue so a reload can resume the same session.
ALTER TABLE "ReviewSession" ADD COLUMN "queue" JSONB;