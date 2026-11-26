-- Stage 3 Gamification: GameEvent ledger, StudentGameProfile, DailyGameState, StudentBadge,
-- ClassGameSetting, ClassChallenge, TeacherCheer, CardInstance.bestStage, ReviewEvent.submissionId,
-- DailyStudyTask.campDay, and AppRelease GAME_CONFIG support.

ALTER TYPE "ReleasePayloadType" ADD VALUE 'GAME_CONFIG';

ALTER TABLE "app_releases" ADD COLUMN "config_payload" JSONB;

ALTER TABLE "CardInstance" ADD COLUMN "bestStage" INTEGER;

UPDATE "CardInstance"
SET "bestStage" = CASE
  WHEN "state" = 'NEW' OR "reps" <= 0 THEN NULL
  WHEN "state" = 'RELEARNING' OR "stability" < 0.15 THEN 1
  WHEN "stability" < 0.45 THEN 2
  WHEN "stability" < 0.9 THEN 3
  WHEN "stability" < 1.8 THEN 4
  WHEN "stability" < 3.5 THEN 5
  WHEN "stability" < 6.5 THEN 6
  WHEN "stability" < 14 THEN 7
  ELSE 8
END;

ALTER TABLE "ReviewEvent" ADD COLUMN "submissionId" TEXT;
CREATE UNIQUE INDEX "ReviewEvent_sessionId_submissionId_key" ON "ReviewEvent"("sessionId", "submissionId");

ALTER TABLE "DailyStudyTask" ADD COLUMN "campDay" INTEGER;

CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "localDate" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentGameProfile" (
    "studentId" TEXT NOT NULL,
    "nickname" TEXT,
    "avatarKey" TEXT NOT NULL DEFAULT 'vanilla',
    "avatarFrame" TEXT NOT NULL DEFAULT 'vanilla',
    "cardSkin" TEXT NOT NULL DEFAULT 'classic',
    "soundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "freezeTickets" INTEGER NOT NULL DEFAULT 0,
    "lastAchievedDate" TEXT,
    "streakCursorDate" TEXT,
    "lastStudiedDate" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentGameProfile_pkey" PRIMARY KEY ("studentId")
);

CREATE TABLE "DailyGameState" (
    "studentId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "xpEarned" INTEGER NOT NULL DEFAULT 0,
    "reviewDue" INTEGER NOT NULL DEFAULT 0,
    "reviewDone" INTEGER NOT NULL DEFAULT 0,
    "reviewedCardIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "levelsPassed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ringsClosed" BOOLEAN NOT NULL DEFAULT false,
    "weakBossDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyGameState_pkey" PRIMARY KEY ("studentId","localDate")
);

CREATE TABLE "StudentBadge" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentBadge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClassGameSetting" (
    "classId" TEXT NOT NULL,
    "leaderboardOpen" BOOLEAN NOT NULL DEFAULT false,
    "weeklyTargetCards" INTEGER NOT NULL DEFAULT 300,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassGameSetting_pkey" PRIMARY KEY ("classId")
);

CREATE TABLE "ClassChallenge" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '本周全班挑战',
    "targetCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeacherCheer" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "studentId" TEXT,
    "presetKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sticker" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherCheer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeacherCheerRead" (
    "cheerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherCheerRead_pkey" PRIMARY KEY ("cheerId","studentId")
);

CREATE UNIQUE INDEX "GameEvent_studentId_type_sourceId_key" ON "GameEvent"("studentId", "type", "sourceId");
CREATE INDEX "GameEvent_studentId_localDate_idx" ON "GameEvent"("studentId", "localDate");
CREATE INDEX "GameEvent_localDate_idx" ON "GameEvent"("localDate");
CREATE UNIQUE INDEX "StudentBadge_studentId_badgeKey_key" ON "StudentBadge"("studentId", "badgeKey");
CREATE UNIQUE INDEX "ClassChallenge_classId_weekStart_key" ON "ClassChallenge"("classId", "weekStart");
CREATE INDEX "TeacherCheer_classId_createdAt_idx" ON "TeacherCheer"("classId", "createdAt");

ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGameProfile" ADD CONSTRAINT "StudentGameProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyGameState" ADD CONSTRAINT "DailyGameState_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentBadge" ADD CONSTRAINT "StudentBadge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassGameSetting" ADD CONSTRAINT "ClassGameSetting_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassChallenge" ADD CONSTRAINT "ClassChallenge_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherCheer" ADD CONSTRAINT "TeacherCheer_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherCheerRead" ADD CONSTRAINT "TeacherCheerRead_cheerId_fkey" FOREIGN KEY ("cheerId") REFERENCES "TeacherCheer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherCheerRead" ADD CONSTRAINT "TeacherCheerRead_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
