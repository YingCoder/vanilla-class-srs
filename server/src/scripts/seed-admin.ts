/**
 * Creates the initial admin user if one does not already exist.
 * Safe to re-run: exits early when an admin is already present.
 *
 * Usage (Docker):
 *   docker compose run --rm seed
 *
 * Non-interactive (CI / scripted deployment):
 *   ADMIN_EMAIL=admin@example.com ADMIN_NAME=Admin \
 *   ADMIN_PASSWORD='<temporary password>' \
 *   docker compose run --rm seed
 *
 * When ADMIN_PASSWORD is omitted, a random temporary password is generated and
 * printed once. The admin must change it on first login in both cases.
 */

import * as readline from 'readline/promises'
import { PrismaClient, Role } from '@prisma/client'
import { hashPassword, generateTempPassword } from '../services/auth.service'

const prisma = new PrismaClient()

function requiredEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value === '' ? undefined : value
}

async function resolveIdentity(): Promise<{ email: string; name: string }> {
  const email = requiredEnv('ADMIN_EMAIL')
  const name = requiredEnv('ADMIN_NAME')

  if (email && name) return { email, name }

  if (!process.stdin.isTTY) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_NAME are required when no interactive terminal is attached.',
    )
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answeredEmail = (await rl.question('Admin email: ')).trim()
    const answeredName = (await rl.question('Admin name:  ')).trim()
    if (!answeredEmail || !answeredName) {
      throw new Error('Email and name are required.')
    }
    return { email: answeredEmail, name: answeredName }
  } finally {
    rl.close()
  }
}

async function main(): Promise<void> {
  const existingAdmin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    select: { email: true },
  })
  if (existingAdmin) {
    console.log(`\nAdmin already exists: ${existingAdmin.email}\nNo changes made.\n`)
    return
  }

  const { email, name } = await resolveIdentity()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('ADMIN_EMAIL is not a valid email address.')
  }

  // A supplied password is allowed for scripted deployment; otherwise generate
  // an unguessable random one (not a date/name-derived value).
  const suppliedPassword = requiredEnv('ADMIN_PASSWORD')
  const plainPassword = suppliedPassword ?? generateTempPassword()
  if (plainPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters.')
  }

  const passwordHash = await hashPassword(plainPassword)

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: Role.ADMIN,
        mustChangePassword: true,
      },
    })
    await tx.teacher.create({ data: { userId: user.id } })
  })

  console.log(`
✓ Admin created

  Email:    ${email}
  Password: ${plainPassword}

  The admin must change this password on first login.
  ${
    suppliedPassword
      ? 'ADMIN_PASSWORD was supplied via environment; rotate it after first login.'
      : 'Store this temporary password securely; it is shown only once.'
  }
`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
