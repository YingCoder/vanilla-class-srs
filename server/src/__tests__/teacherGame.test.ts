import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'

vi.mock('../lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    teacher: {
      findUnique: vi.fn(),
    },
    student: {
      findUnique: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    appRelease: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    reviewSession: { findUnique: vi.fn() },
    cardInstance: { findUnique: vi.fn() },
    enrollment: { findMany: vi.fn() },
    classGameSetting: { findUnique: vi.fn() },
    classChallenge: { findUnique: vi.fn() },
    teacherCheer: { findMany: vi.fn() },
  },
}))

import prisma from '../lib/prisma'
import { requireAuth, requireAdmin, requireTeacher, requirePasswordChanged } from '../middleware/auth'
import { manageReleasesRouter } from '../routes/releases'
import { createStaffGameRouter } from '../routes/teacherGame'
import studentsRouter from '../routes/students'

function makeToken(sub: string, role: 'STUDENT' | 'TEACHER' | 'ADMIN') {
  const secret = process.env.JWT_SECRET ?? 'test-secret'
  process.env.JWT_SECRET = secret
  return jwt.sign({ sub, role, sv: 0 }, secret)
}

async function callApp(
  app: express.Express,
  method: string,
  path: string,
  token: string,
  body?: unknown,
) {
  const server = app.listen(0)
  try {
    const addr = server.address() as { port: number }
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: {
        Cookie: `access_token=${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, json }
  } finally {
    server.close()
  }
}

describe('Stage 3 RBAC, GAME_CONFIG guardrails & anti-tampering (QA-G03, G15, G16)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
      if (where.id === 'student-user') return { sessionVersion: 0, mustChangePassword: false, name: 'S1' }
      if (where.id === 'teacher-user') return { sessionVersion: 0, mustChangePassword: false, name: 'T1' }
      if (where.id === 'admin-user') return { sessionVersion: 0, mustChangePassword: false, name: 'Admin' }
      return null
    })
  })

  function buildApp() {
    const app = express()
    app.use(express.json())
    app.use(cookieParser())
    app.use('/api/admin/releases', requireAuth, requireAdmin, requirePasswordChanged, manageReleasesRouter)
    app.use('/api/teachers/releases', requireAuth, requireTeacher, requirePasswordChanged, manageReleasesRouter)
    app.use('/api/teachers/game', createStaffGameRouter('teacher'))
    app.use('/api/admin/game', createStaffGameRouter('admin'))
    app.use('/api/students', studentsRouter)
    return app
  }

  it('QA-G16: rejects student on /api/teachers/game/* and /api/admin/releases with 403', async () => {
    const app = buildApp()
    const token = makeToken('student-user', 'STUDENT')

    const r1 = await callApp(app, 'GET', '/api/teachers/game/overview?classId=00000000-0000-0000-0000-000000000001', token)
    expect(r1.status).toBe(403)

    const r2 = await callApp(app, 'GET', '/api/admin/releases', token)
    expect(r2.status).toBe(403)
  })

  it('QA-G16: rejects teacher requesting another teacher classId with 403 Forbidden', async () => {
    const app = buildApp()
    const token = makeToken('teacher-user', 'TEACHER')

    ;(prisma.teacher.findUnique as any).mockResolvedValue({ id: 'teacher-1' })
    ;(prisma.class.findUnique as any).mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000002',
      teacherId: 'teacher-other',
      archivedAt: null,
      subjectGrade: { id: 'sg-1', name: 'G11' },
    })

    const res = await callApp(
      app,
      'GET',
      '/api/teachers/game/overview?classId=00000000-0000-0000-0000-000000000002',
      token,
    )
    expect(res.status).toBe(403)
  })

  it('QA-G15: rejects teacher GAME_CONFIG publish (403) and out-of-bounds admin GAME_CONFIG (400)', async () => {
    const app = buildApp()
    const teacherToken = makeToken('teacher-user', 'TEACHER')
    const adminToken = makeToken('admin-user', 'ADMIN')

    const teacherTry = await callApp(app, 'POST', '/api/teachers/releases', teacherToken, {
      version: 'v3.0.1',
      packVersion: 'Pack-23D-688',
      title: 'Test',
      notes: 'Try',
      pushMode: 'SILENT',
      payloadType: 'GAME_CONFIG',
      configPayload: { dailyXpCap: 400 },
    })
    expect(teacherTry.status).toBe(403)

    const badBounds = await callApp(app, 'POST', '/api/admin/releases', adminToken, {
      version: 'v3.0.1',
      packVersion: 'Pack-23D-688',
      title: 'Bad Config',
      notes: 'Out of bounds',
      pushMode: 'SILENT',
      payloadType: 'GAME_CONFIG',
      configPayload: { dailyXpCap: 99999 },
    })
    expect(badBounds.status).toBe(400)

    ;(prisma.appRelease.create as any).mockResolvedValue({
      id: 'rel-1',
      version: 'v3.0.1',
      payloadType: 'GAME_CONFIG',
    })
    const valid = await callApp(app, 'POST', '/api/admin/releases', adminToken, {
      version: 'v3.0.1',
      packVersion: 'Pack-23D-688',
      title: 'Valid Config',
      notes: 'Raise cap safely',
      pushMode: 'SILENT',
      payloadType: 'GAME_CONFIG',
      configPayload: { dailyXpCap: 500 },
    })
    expect(valid.status).toBe(201)
  })

  it('QA-G03: ignores tampered xp field in POST /api/students/review/grade', async () => {
    const app = buildApp()
    const token = makeToken('student-user', 'STUDENT')
    ;(prisma.student.findUnique as any).mockResolvedValue({ id: 'student-1' })
    ;(prisma.reviewSession.findUnique as any).mockResolvedValue(null)

    const res = await callApp(app, 'POST', '/api/students/review/grade', token, {
      sessionId: '00000000-0000-0000-0000-000000000010',
      instanceId: '00000000-0000-0000-0000-000000000011',
      grade: 3,
      xp: 9999,
    })
    // Passes Zod validation cleanly (strips tampered xp) and reaches session lookup (404) rather than trusting xp
    expect(res.status).toBe(404)
  })
})
