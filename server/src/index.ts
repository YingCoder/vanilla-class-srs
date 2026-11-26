import { requireAuth, requireAdmin, requireTeacher, requirePasswordChanged } from './middleware/auth'
import leadershipRouter from './routes/leadership'
import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'

import authRouter from './routes/auth'
import adminRouter from './routes/admin'
import teachersRouter from './routes/teachers'
import studentsRouter from './routes/students'
import studentTaskRouter from './routes/studentTask'
import studentGameRouter from './routes/studentGame'
import studentStage4Router from './routes/studentStage4'
import { createStaffGameRouter } from './routes/teacherGame'
import { createStaffStage4Router } from './routes/staffStage4'
import { createStaffMnemonicRouter } from './routes/mnemonics'
import cardsetsRouter from './routes/cardsets'
import { publicReleasesRouter, manageReleasesRouter } from './routes/releases'

// Express 4 does not catch rejections from async handlers, and an unhandled
// rejection crashes the Node process by default — Docker restarts it, but
// every in-flight request (including a student mid-session) dies with it.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

const app = express()
const PORT = process.env.PORT ?? 3000

app.use(cors({
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())

// Routes
app.use('/api/releases', publicReleasesRouter)
app.use('/api/admin/releases', requireAuth, requireAdmin, requirePasswordChanged, manageReleasesRouter)
app.use('/api/teachers/releases', requireAuth, requireTeacher, requirePasswordChanged, manageReleasesRouter)
app.use('/api/teachers/leadership', leadershipRouter)
app.use('/api/admin/leadership', requireAuth, requireAdmin, requirePasswordChanged, leadershipRouter)
app.use('/api/auth', authRouter)
app.use('/api/admin/game', createStaffGameRouter('admin'))
app.use('/api/admin/mnemonics', requireAuth, requireAdmin, requirePasswordChanged, createStaffMnemonicRouter())
app.use('/api/admin', createStaffStage4Router('admin'))
app.use('/api/admin', adminRouter)
app.use('/api/teachers/game', createStaffGameRouter('teacher'))
app.use('/api/teachers/mnemonics', requireAuth, requireTeacher, requirePasswordChanged, createStaffMnemonicRouter())
app.use('/api/teachers', createStaffStage4Router('teacher'))
app.use('/api/teachers', teachersRouter)
app.use('/api/teachers/cardsets', cardsetsRouter)
app.use('/api/students/game', studentGameRouter)
app.use('/api/students', studentStage4Router)
app.use('/api/students', studentTaskRouter)
app.use('/api/students', studentsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Catches rejected promises from async route handlers (Express 4 doesn't) and
// any synchronous throw that reaches here without a response already sent.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err)
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
