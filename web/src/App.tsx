import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Loading } from './components/ui'
import { Assistant } from './pages/Assistant'
import { Automation } from './pages/Automation'
import { Chat } from './pages/Chat'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { Profile } from './pages/Profile'
import { Reports, ReportView } from './pages/Reports'
import { TaskDetail } from './pages/TaskDetail'
import { Tasks } from './pages/Tasks'
import { Team } from './pages/Team'
import { SessionProvider, useSession } from './session'

function Gate() {
  const { user, ready } = useSession()
  if (!ready) return <Loading />
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }
  const leaderOnly = (el: ReactNode) => (user.role === 'LEADER' ? el : <Navigate to="/" replace />)
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="chat" element={<Chat />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="profile" element={<Profile />} />
        <Route path="reports" element={leaderOnly(<Reports />)} />
        <Route path="reports/:id" element={leaderOnly(<ReportView />)} />
        <Route path="team" element={leaderOnly(<Team />)} />
        <Route path="automation" element={leaderOnly(<Automation />)} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </BrowserRouter>
  )
}
