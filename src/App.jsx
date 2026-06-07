import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CrewHub from './pages/CrewHub'
import Crew from './pages/Crew'
import Contracts from './pages/Contracts'
import ContractDetail from './pages/ContractDetail'
import Landings from './pages/Landings'
import Closeout from './pages/Closeout'
import OneOffs from './pages/OneOffs'
const Sales = lazy(() => import('./pages/Sales'))
const Estimator = lazy(() => import('./pages/Estimator'))
const SquareUp = lazy(() => import('./squareup/SquareUp'))

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
        <Route path="/contracts/:id" element={
          <ProtectedRoute>
            <ContractDetail />
          </ProtectedRoute>
        } />
        <Route path="/landings" element={
          <ProtectedRoute>
            <Landings />
          </ProtectedRoute>
        } />
        <Route path="/closeout" element={
          <ProtectedRoute>
            <Closeout />
          </ProtectedRoute>
        } />
        <Route path="/one-offs" element={
          <ProtectedRoute>
            <OneOffs />
          </ProtectedRoute>
        } />
        <Route path="/crew-hub" element={
          <ProtectedRoute>
            <CrewHub />
          </ProtectedRoute>
        } />
        <Route path="/estimator" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Estimator />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/squareup" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <SquareUp />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/sales" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Sales />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
