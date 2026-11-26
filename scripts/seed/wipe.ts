import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env from root .env (DATABASE_URL lives there)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function wipe(): Promise<void> {
  console.log('Wiping all data...');

  // Delete in reverse dependency order to respect FK constraints
  await prisma.vocabPackItem.deleteMany();
  await prisma.vocabPack.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.classSeason.deleteMany();
  await prisma.squadCheer.deleteMany();
  await prisma.squadWeek.deleteMany();
  await prisma.squadMember.deleteMany();
  await prisma.squad.deleteMany();
  await prisma.mnemonicEntry.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.reminderPref.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.analyticsDailyRollup.deleteMany();
  await prisma.analyticsEvent.deleteMany();
  await prisma.teacherCheerRead.deleteMany();
  await prisma.teacherCheer.deleteMany();
  await prisma.classChallenge.deleteMany();
  await prisma.classGameSetting.deleteMany();
  await prisma.studentBadge.deleteMany();
  await prisma.dailyGameState.deleteMany();
  await prisma.gameEvent.deleteMany();
  await prisma.studentGameProfile.deleteMany();

  await prisma.reviewEvent.deleteMany();
  console.log('  ✓ ReviewEvent');

  await prisma.reviewSession.deleteMany();
  console.log('  ✓ ReviewSession');

  await prisma.cardInstance.deleteMany();
  console.log('  ✓ CardInstance');

  await prisma.deck.deleteMany();
  console.log('  ✓ Deck');

  await prisma.homeworkRequirement.deleteMany();
  console.log('  ✓ HomeworkRequirement');

  await prisma.enrollment.deleteMany();
  console.log('  ✓ Enrollment');

  await prisma.subjectGradeAssignment.deleteMany();
  console.log('  ✓ SubjectGradeAssignment');

  await prisma.assignment.deleteMany();
  console.log('  ✓ Assignment');

  await prisma.card.deleteMany();
  console.log('  ✓ Card');

  await prisma.cardSet.deleteMany();
  console.log('  ✓ CardSet');

  await prisma.teacherSubjectGrade.deleteMany();
  console.log('  ✓ TeacherSubjectGrade');

  await prisma.class.deleteMany();
  console.log('  ✓ Class');

  await prisma.teacher.deleteMany();
  console.log('  ✓ Teacher');

  await prisma.student.deleteMany();
  console.log('  ✓ Student');

  await prisma.passwordResetToken.deleteMany();
  console.log('  ✓ PasswordResetToken');

  await prisma.user.deleteMany();
  console.log('  ✓ User');

  await prisma.subjectGrade.deleteMany();
  console.log('  ✓ SubjectGrade');

  await prisma.department.deleteMany();
  console.log('  ✓ Department');

  await prisma.appRelease.deleteMany();
  console.log('  ✓ AppRelease');

  console.log('\nAll data wiped successfully.');
}

wipe()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error('Wipe failed:', err);
    prisma.$disconnect();
    process.exit(1);
  });
