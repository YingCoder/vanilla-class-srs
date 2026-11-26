import 'dotenv/config'
import prisma from '../lib/prisma'
import { generateAllClassWeeklyReports } from '../services/weeklyReport.service'

async function main() {
  const reports = await generateAllClassWeeklyReports(prisma, new Date())
  console.log(JSON.stringify({ generated: reports.length, reports }, null, 2))
}

main()
  .catch((err) => {
    console.error('Weekly report generation failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
