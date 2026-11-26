import 'dotenv/config'
import prisma from '../lib/prisma'
import { dispatchDueReminders } from '../services/reminder.service'

async function main() {
  const summary = await dispatchDueReminders(prisma, new Date())
  console.log(JSON.stringify(summary, null, 2))
}

main()
  .catch((err) => {
    console.error('Reminder dispatch failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
