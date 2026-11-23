-- Daily study tasks, level sessions, frozen questions and idempotent answers.

CREATE TYPE "DailyTaskStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');
CREATE TYPE "DailyTaskWordKind" AS ENUM ('NEW', 'REVIEW');
CREATE TYPE "StudyLevel" AS ENUM ('L1', 'L2', 'L3', 'L5', 'BOSS', 'REVIEW');
CREATE TYPE "LevelSessionState" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "LevelQuestionType" AS ENUM ('L2', 'L3', 'L5');

CREATE TABLE "DailyStudyTask" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "studyDate" TEXT NOT NULL,
    "status" "DailyTaskStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "newWordTarget" INTEGER NOT NULL,
    "reviewTarget" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DailyStudyTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyTaskWord" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "cardInstanceId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "kind" "DailyTaskWordKind" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "word" TEXT NOT NULL,
    "pos" TEXT,
    "definitionL2" TEXT,
    "definitionL1" TEXT,
    "variants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "exampleSentence" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "scheduledRating" INTEGER,
    "scheduledSessionId" TEXT,

    CONSTRAINT "DailyTaskWord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LevelSession" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "level" "StudyLevel" NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "state" "LevelSessionState" NOT NULL DEFAULT 'IN_PROGRESS',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "firstTryCorrect" INTEGER NOT NULL DEFAULT 0,
    "eventuallyCorrect" INTEGER NOT NULL DEFAULT 0,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "cleared" BOOLEAN,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LevelSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LevelQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "taskWordId" TEXT NOT NULL,
    "questionType" "LevelQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "pos" TEXT,
    "options" JSONB,
    "correctAnswer" TEXT NOT NULL,
    "acceptedAnswers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "hintLevel" INTEGER NOT NULL DEFAULT 0,
    "firstTryCorrect" BOOLEAN NOT NULL DEFAULT false,
    "eventuallyCorrect" BOOLEAN NOT NULL DEFAULT false,
    "answerRevealed" BOOLEAN NOT NULL DEFAULT false,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "LevelQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LevelAnswer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "hintLevel" INTEGER NOT NULL,
    "responseMs" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyStudyTask_enrollmentId_studyDate_key" ON "DailyStudyTask"("enrollmentId", "studyDate");
CREATE INDEX "DailyStudyTask_enrollmentId_status_idx" ON "DailyStudyTask"("enrollmentId", "status");
CREATE UNIQUE INDEX "DailyTaskWord_taskId_cardInstanceId_key" ON "DailyTaskWord"("taskId", "cardInstanceId");
CREATE INDEX "DailyTaskWord_taskId_kind_sortOrder_idx" ON "DailyTaskWord"("taskId", "kind", "sortOrder");
CREATE UNIQUE INDEX "LevelSession_taskId_level_attemptNo_key" ON "LevelSession"("taskId", "level", "attemptNo");
CREATE INDEX "LevelSession_taskId_level_idx" ON "LevelSession"("taskId", "level");
CREATE INDEX "LevelQuestion_sessionId_sortOrder_idx" ON "LevelQuestion"("sessionId", "sortOrder");
CREATE UNIQUE INDEX "LevelAnswer_sessionId_submissionId_key" ON "LevelAnswer"("sessionId", "submissionId");
CREATE INDEX "LevelAnswer_sessionId_questionId_idx" ON "LevelAnswer"("sessionId", "questionId");

ALTER TABLE "DailyStudyTask" ADD CONSTRAINT "DailyStudyTask_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DailyTaskWord" ADD CONSTRAINT "DailyTaskWord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DailyStudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelSession" ADD CONSTRAINT "LevelSession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "DailyStudyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelQuestion" ADD CONSTRAINT "LevelQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelQuestion" ADD CONSTRAINT "LevelQuestion_taskWordId_fkey" FOREIGN KEY ("taskWordId") REFERENCES "DailyTaskWord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelAnswer" ADD CONSTRAINT "LevelAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LevelAnswer" ADD CONSTRAINT "LevelAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "LevelQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
