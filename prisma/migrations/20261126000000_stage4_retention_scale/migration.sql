-- AlterTable
ALTER TABLE "ClassGameSetting" ADD COLUMN     "activePackId" TEXT,
ADD COLUMN     "mnemonicCoCreateOpen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "squadEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudentGameProfile" ADD COLUMN     "fontScale" TEXT NOT NULL DEFAULT 'normal',
ADD COLUMN     "lowSpecMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unlockedSkins" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "app_releases" ADD COLUMN     "scope" JSONB;

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT,
    "clientEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "props" JSONB,
    "clientVersion" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dayKey" TEXT NOT NULL,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDailyRollup" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "uniqueStudents" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDailyRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderPref" (
    "studentId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "hour" INTEGER NOT NULL DEFAULT 19,
    "pausedUntil" TEXT,
    "consecutiveUnopened" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderPref_pkey" PRIMARY KEY ("studentId")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WEB_PUSH',
    "localDate" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MnemonicEntry" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "campDay" INTEGER,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT,
    "authorRole" TEXT NOT NULL,
    "authorNickname" TEXT,
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "batchId" TEXT,
    "tag" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "chunks" JSONB NOT NULL,
    "trap" TEXT,
    "example" TEXT,
    "releaseVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "MnemonicEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Squad" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Squad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadMember" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "SquadMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadWeek" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "achieved" BOOLEAN NOT NULL DEFAULT false,
    "achievedAt" TIMESTAMP(3),

    CONSTRAINT "SquadWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadCheer" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "senderStudentId" TEXT NOT NULL,
    "presetKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sticker" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SquadCheer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSeason" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '中考冲刺赛季',
    "examDate" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AUTO',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabPack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "daysCount" INTEGER NOT NULL DEFAULT 1,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VocabPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabPackItem" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "day" INTEGER NOT NULL DEFAULT 1,
    "word" TEXT NOT NULL,
    "ipa" TEXT,
    "meaning" TEXT NOT NULL,
    "mnemonic" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VocabPackItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_classId_dayKey_type_idx" ON "AnalyticsEvent"("classId", "dayKey", "type");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_studentId_dayKey_idx" ON "AnalyticsEvent"("studentId", "dayKey");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_dayKey_idx" ON "AnalyticsEvent"("dayKey");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_studentId_clientEventId_key" ON "AnalyticsEvent"("studentId", "clientEventId");

-- CreateIndex
CREATE INDEX "AnalyticsDailyRollup_dayKey_idx" ON "AnalyticsDailyRollup"("dayKey");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDailyRollup_classId_dayKey_type_key" ON "AnalyticsDailyRollup"("classId", "dayKey", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_studentId_idx" ON "PushSubscription"("studentId");

-- CreateIndex
CREATE INDEX "ReminderLog_studentId_localDate_idx" ON "ReminderLog"("studentId", "localDate");

-- CreateIndex
CREATE INDEX "ReminderLog_studentId_weekStart_idx" ON "ReminderLog"("studentId", "weekStart");

-- CreateIndex
CREATE INDEX "MnemonicEntry_word_status_idx" ON "MnemonicEntry"("word", "status");

-- CreateIndex
CREATE INDEX "MnemonicEntry_status_campDay_idx" ON "MnemonicEntry"("status", "campDay");

-- CreateIndex
CREATE INDEX "MnemonicEntry_batchId_idx" ON "MnemonicEntry"("batchId");

-- CreateIndex
CREATE INDEX "Squad_classId_archivedAt_idx" ON "Squad"("classId", "archivedAt");

-- CreateIndex
CREATE INDEX "SquadMember_studentId_leftAt_idx" ON "SquadMember"("studentId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "SquadMember_squadId_studentId_key" ON "SquadMember"("squadId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SquadWeek_squadId_weekStart_key" ON "SquadWeek"("squadId", "weekStart");

-- CreateIndex
CREATE INDEX "SquadCheer_squadId_weekStart_idx" ON "SquadCheer"("squadId", "weekStart");

-- CreateIndex
CREATE INDEX "SquadCheer_senderStudentId_localDate_idx" ON "SquadCheer"("senderStudentId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSeason_classId_key" ON "ClassSeason"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReport_classId_weekStart_key" ON "WeeklyReport"("classId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "VocabPack_slug_key" ON "VocabPack"("slug");

-- CreateIndex
CREATE INDEX "VocabPackItem_packId_day_idx" ON "VocabPackItem"("packId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "VocabPackItem_packId_word_key" ON "VocabPackItem"("packId", "word");

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderPref" ADD CONSTRAINT "ReminderPref_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadMember" ADD CONSTRAINT "SquadMember_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadMember" ADD CONSTRAINT "SquadMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadWeek" ADD CONSTRAINT "SquadWeek_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadCheer" ADD CONSTRAINT "SquadCheer_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadCheer" ADD CONSTRAINT "SquadCheer_senderStudentId_fkey" FOREIGN KEY ("senderStudentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSeason" ADD CONSTRAINT "ClassSeason_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabPackItem" ADD CONSTRAINT "VocabPackItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "VocabPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "HomeworkRequirementCardSet_homeworkRequirementId_cardSetI_key" RENAME TO "HomeworkRequirementCardSet_homeworkRequirementId_cardSetId_key";

