-- A fixed rate on the authoritative XP event prevents configuration changes,
-- class switching or repeated reads from revaluing historical sugar income.
ALTER TABLE "GameEvent" ADD COLUMN "sugarCrystalRatio" DECIMAL(5,4) NOT NULL DEFAULT 0.1;
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_sugarCrystalRatio_check"
  CHECK ("sugarCrystalRatio" >= 0 AND "sugarCrystalRatio" <= 1);

CREATE TABLE "StudentHomeBuilding" (
  "studentId" TEXT NOT NULL,
  "buildingKey" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "cost" INTEGER NOT NULL,
  "requestId" TEXT NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentHomeBuilding_pkey" PRIMARY KEY ("studentId", "buildingKey", "level"),
  CONSTRAINT "StudentHomeBuilding_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudentHomeBuilding_paid_key_check" CHECK ("buildingKey" IN ('lighthouse', 'album_tower', 'flag_square')),
  CONSTRAINT "StudentHomeBuilding_level_check" CHECK ("level" IN (1, 2)),
  CONSTRAINT "StudentHomeBuilding_cost_check" CHECK ("cost" >= 0)
);
CREATE UNIQUE INDEX "StudentHomeBuilding_studentId_requestId_key" ON "StudentHomeBuilding"("studentId", "requestId");

-- Home forecasts and its three-spirit selection must not load an entire deck.
CREATE INDEX "CardInstance_deckId_state_due_idx" ON "CardInstance"("deckId", "state", "due");
CREATE INDEX "CardInstance_deckId_bestStage_id_idx" ON "CardInstance"("deckId", "bestStage" DESC, "id");
