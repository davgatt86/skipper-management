import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Crew from './pages/Crew'
import Contracts from './pages/Contracts'
import Landings from './pages/Landings'

function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--grey-400)'
      }}>
        Loading…
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace />
  }
  return children
}

function PublicOnly({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={
          <PublicOnly>
            <Login />
          </PublicOnly>
        } />
        <Route path="/" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/crew" element={
          <ProtectedRoute>
            <Crew />
          </ProtectedRoute>
        } />
        <Route path="/contracts" element={
          <ProtectedRoute>
            <Contracts />
          </ProtectedRoute>
        } />
        <Route path="/landings" element={
          <ProtectedRoute>
            <Landings />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
