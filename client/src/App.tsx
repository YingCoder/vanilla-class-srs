import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './components/AuthProvider'
import { EnrollmentProvider } from './components/EnrollmentProvider'
import { useAuth } from './utils/auth'

// Auth pages
import LoginPage from './pages/auth/LoginPage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import ResetPasswordPage from './pages/auth/ResetPasswordPage'
import ChangePasswordPage from './pages/auth/ChangePasswordPage'

// Student pages (loaded eagerly for fast mobile App boot)
import StudentLayout from './pages/student/StudentLayout'
import EnrollmentPickerPage from './pages/student/EnrollmentPickerPage'
import StudentDeckPage from './pages/student/DeckPage'
import ReviewPage from './pages/student/ReviewPage'
import SpellingPage from './pages/student/SpellingPage'
import ChoicePage from './pages/student/ChoicePage'
import StudentStatsPage from './pages/student/StatsPage'
import RewardsPage from './pages/student/RewardsPage'
import ClassCardSetsPage from './pages/student/ClassCardSetsPage'
import TaskPage from './pages/student/TaskPage'
import LevelSessionPage from './pages/student/LevelSessionPage'
import WorldHome from './components/WorldHome'

// Lazy-loaded Staff Bundles (keep Student mobile first-screen JS lightweight §7.9)
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminDepartmentsPage = lazy(() => import('./pages/admin/DepartmentsPage'))
const AdminDepartmentSettingsPage = lazy(() => import('./pages/admin/DepartmentSettingsPage'))
const AdminSubjectGradesPage = lazy(() => import('./pages/admin/SubjectGradesPage'))
const AdminBatchOperationsPage = lazy(() => import('./pages/admin/BatchOperationsPage'))
const AdminTeachersPage = lazy(() => import('./pages/admin/TeachersPage'))
const AdminCardSetsPage = lazy(() => import('./pages/admin/CardSetsPage'))
const AdminCardSetDetailPage = lazy(() => import('./pages/admin/CardSetDetailPage'))
const AdminClassesPage = lazy(() => import('./pages/admin/ClassesPage'))
const AdminClassDetailPage = lazy(() => import('./pages/admin/ClassDetailPage'))
const AdminStatsPage = lazy(() => import('./pages/admin/StatsPage'))
const AdminStudentAdditionsPage = lazy(() => import('./pages/admin/StudentAdditionsPage'))
const AdminReleasesPage = lazy(() => import('./pages/admin/ReleasesPage'))
const AdminGamePage = lazy(() => import('./pages/admin/GamePage'))

const TeacherLayout = lazy(() => import('./pages/teacher/TeacherLayout'))
const TeacherClassesPage = lazy(() => import('./pages/teacher/ClassesPage'))
const TeacherClassDetailPage = lazy(() => import('./pages/teacher/ClassDetailPage'))
const TeacherStudentCardsPage = lazy(() => import('./pages/teacher/StudentCardsPage'))
const TeacherCardSetsPage = lazy(() => import('./pages/teacher/CardSetsPage'))
const TeacherCardSetDetailPage = lazy(() => import('./pages/teacher/CardSetDetailPage'))
const TeacherStudentStatsPage = lazy(() => import('./pages/teacher/StudentStatsPage'))
const TeacherReleasesPage = lazy(() => import('./pages/teacher/ReleasesPage'))
const TeacherGamePage = lazy(() => import('./pages/teacher/GamePage'))
const StaffMnemonicsPage = lazy(() => import('./pages/staff/StaffMnemonicsPage'))
const LeadershipPage = lazy(() => import('./pages/teacher/LeadershipPage'))
const StaffStudentDeckPage = lazy(() => import('./pages/teacher/StudentDeckPage'))

function RequireAuth({ children, role }: { children: JSX.Element; role?: string }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  const allowed = role === 'TEACHER' ? user.role === 'TEACHER' || user.role === 'ADMIN' : !role || user.role === role
  if (!allowed) return <Navigate to="/" replace />
  return children
}

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />
  if (user.role === 'ADMIN') return <Navigate to="/admin/departments" replace />
  if (user.role === 'TEACHER') return <Navigate to="/teacher/classes" replace />
  return <Navigate to="/student" replace />
}

function StaffFallback() {
  return <div className="loading-center"><div className="spinner" /></div>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <EnrollmentProvider>
          <Suspense fallback={<StaffFallback />}>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/change-password" element={<ChangePasswordPage />} />

              {/* Root redirect */}
              <Route path="/" element={<RootRedirect />} />

              {/* Admin */}
              <Route path="/admin" element={<RequireAuth role="ADMIN"><AdminLayout /></RequireAuth>}>
                <Route index element={<Navigate to="/admin/departments" replace />} />
                <Route path="departments" element={<AdminDepartmentsPage />} />
                <Route path="departments/:id/settings" element={<AdminDepartmentSettingsPage />} />
                <Route path="subject-grades" element={<AdminSubjectGradesPage />} />
                <Route path="subject-grades/:id/batch" element={<AdminBatchOperationsPage />} />
                <Route path="teachers" element={<AdminTeachersPage />} />
                <Route path="cardsets" element={<AdminCardSetsPage />} />
                <Route path="cardsets/:id" element={<AdminCardSetDetailPage />} />
                <Route path="classes" element={<AdminClassesPage />} />
                <Route path="classes/:id" element={<AdminClassDetailPage />} />
                <Route path="leadership" element={<LeadershipPage />} />
                <Route path="leadership/:id" element={<LeadershipPage />} />
                <Route path="classes/:id/students/:studentId/deck" element={<StaffStudentDeckPage />} />
                <Route path="classes/:id/students/:studentId" element={<TeacherStudentCardsPage />} />
                <Route path="classes/:classId/students/:studentId/stats" element={<TeacherStudentStatsPage />} />
                <Route path="stats" element={<AdminStatsPage />} />
                <Route path="stats/student-additions" element={<AdminStudentAdditionsPage />} />
                <Route path="game" element={<AdminGamePage />} />
                <Route path="mnemonics" element={<StaffMnemonicsPage scope="admin" />} />
                <Route path="releases" element={<AdminReleasesPage />} />
              </Route>

              {/* Teacher */}
              <Route path="/teacher" element={<RequireAuth role="TEACHER"><TeacherLayout /></RequireAuth>}>
                <Route index element={<Navigate to="/teacher/classes" replace />} />
                <Route path="classes" element={<TeacherClassesPage />} />
                <Route path="classes/:id" element={<TeacherClassDetailPage />} />
                <Route path="leadership" element={<LeadershipPage />} />
                <Route path="leadership/:id" element={<LeadershipPage />} />
                <Route path="classes/:id/students/:studentId/deck" element={<StaffStudentDeckPage />} />
                <Route path="classes/:id/students/:studentId" element={<TeacherStudentCardsPage />} />
                <Route path="classes/:classId/students/:studentId/stats" element={<TeacherStudentStatsPage />} />
                <Route path="cardsets" element={<TeacherCardSetsPage />} />
                <Route path="cardsets/:id" element={<TeacherCardSetDetailPage />} />
                <Route path="game" element={<TeacherGamePage />} />
                <Route path="mnemonics" element={<StaffMnemonicsPage scope="teacher" />} />
                <Route path="releases" element={<TeacherReleasesPage />} />
              </Route>

              {/* Student */}
              <Route path="/student" element={<RequireAuth role="STUDENT"><StudentLayout /></RequireAuth>}>
                <Route index element={<EnrollmentPickerPage />} />
                <Route path="task" element={<WorldHome />} />
                <Route path="adventure" element={<TaskPage />} />
                <Route path="home" element={<WorldHome />} />
                <Route path="levels/:id" element={<LevelSessionPage />} />
                <Route path="deck" element={<StudentDeckPage />} />
                <Route path="review" element={<ReviewPage />} />
                <Route path="spelling" element={<SpellingPage />} />
                <Route path="choice" element={<ChoicePage />} />
                <Route path="stats" element={<StudentStatsPage />} />
                <Route path="rewards" element={<RewardsPage />} />
                <Route path="cardsets" element={<ClassCardSetsPage />} />
                <Route path="optional" element={<Navigate to="/student/cardsets" replace />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </EnrollmentProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
