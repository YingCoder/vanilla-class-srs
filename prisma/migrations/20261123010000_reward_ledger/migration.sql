-- Gamification ledger. Balances are derived from these rows; the unique key is
-- the idempotency guard for retries and duplicate finish requests.
CREATE TYPE "RewardType" AS ENUM ('XP', 'COIN');

CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "studyDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RewardEvent_userId_eventKey_rewardType_key"
    ON "RewardEvent"("userId", "eventKey", "rewardType");

CREATE INDEX "RewardEvent_userId_studyDate_idx"
    ON "RewardEvent"("userId", "studyDate");

ALTER TABLE "RewardEvent"
    ADD CONSTRAINT "RewardEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;