import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Crew from './pages/Crew'
import ContractedCrew from './pages/ContractedCrew'
import Contracts from './pages/Contracts'
import ContractDetail from './pages/ContractDetail'
import Landings from './pages/Landings'
import Closeout from './pages/Closeout'
import OneOffs from './pages/OneOffs'
import Settings from './pages/Settings'
import AddBoat from './pages/AddBoat'
import Users from './pages/Users'
const Sales = lazy(() => import('./pages/Sales'))
const SalesInsights = lazy(() => import('./pages/SalesInsights'))
const Estimator = lazy(() => import('./pages/Estimator'))
const SquareUp = lazy(() => import('./squareup/SquareUp'))
const Quota = lazy(() => import('./pages/Quota'))
const DailyPrices = lazy(() => import('./pages/DailyPrices'))
const Rota = lazy(() => import('./pages/Rota'))
const Password = lazy(() => import('./pages/Password'))
const VesselDetails = lazy(() => import('./pages/VesselDetails'))
const CrewList = lazy(() => import('./pages/CrewList'))
const Forecast = lazy(() => import('./pages/Forecast'))
const StowagePlan = lazy(() => import('./pages/StowagePlan'))
const SalesCompare = lazy(() => import('./pages/SalesCompare'))
const PriceVsFleet = lazy(() => import('./pages/PriceVsFleet'))
const Alerts = lazy(() => import('./pages/Alerts'))
const EngineLogs = lazy(() => import('./pages/EngineLogs'))
const CrewCertsRegister = lazy(() => import('./pages/CrewCertsRegister'))
const Settlements = lazy(() => import('./pages/Settlements'))

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
        <Route path="/settings" element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        } />
        <Route path="/add-boat" element={
          <ProtectedRoute>
            <AddBoat />
          </ProtectedRoute>
        } />
        <Route path="/users" element={
          <ProtectedRoute>
            <Users />
          </ProtectedRoute>
        } />
        <Route path="/contracted-crew" element={
          <ProtectedRoute>
            <ContractedCrew />
          </ProtectedRoute>
        } />
        {/* The crew hub was a tile wall duplicating the sidebar. Its five
            contracted-crew tiles are now the one workflow at /contracted-crew,
            and its status list is section 1 at /crew. Old links still land
            somewhere sensible. */}
        <Route path="/crew-hub" element={<Navigate to="/crew" replace />} />
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
        <Route path="/password" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Password />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/rota" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Rota />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/quota" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Quota />
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
        <Route path="/sales-insights" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <SalesInsights />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/daily-prices" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <DailyPrices />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/vessel" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <VesselDetails />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/crew-list" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <CrewList />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/forecast" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Forecast />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/stowage" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <StowagePlan />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/sales-compare" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <SalesCompare />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/price-vs-fleet" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <PriceVsFleet />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/alerts" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Alerts />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/engine-logs" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <EngineLogs />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/crew-certs" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <CrewCertsRegister />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/settlements" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Settlements />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
