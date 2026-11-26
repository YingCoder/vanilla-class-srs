import 'dotenv/config'
import prisma from '../lib/prisma'
import { reconcileGamificationLedger } from '../services/reconcile.service'

async function main() {
  const report = await reconcileGamificationLedger(prisma, { writeAlertLog: true })
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) {
    console.error(`[ALERT] Ledger reconciliation found ${report.discrepancies.length} discrepancy(ies)!`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('Reconcile failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
