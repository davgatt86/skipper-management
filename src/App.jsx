import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import AppShell from './AppShell'
import { canSee, accessForPath } from './nav'
import { isOfficer, isCook } from './lib/roles'
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
const VesselCerts = lazy(() => import('./pages/VesselCerts'))
const FuelLog = lazy(() => import('./pages/FuelLog'))
const GearLog = lazy(() => import('./pages/GearLog'))
const Familiarisation = lazy(() => import('./pages/Familiarisation'))
const GarbageLog = lazy(() => import('./pages/GarbageLog'))
const BuyerLeague = lazy(() => import('./pages/BuyerLeague'))
const Activity = lazy(() => import('./pages/Activity'))
const Reconcile = lazy(() => import('./pages/Reconcile'))
const EngineerHome = lazy(() => import('./pages/EngineerHome'))
const Maintenance = lazy(() => import('./pages/Maintenance'))
const Parts = lazy(() => import('./pages/Parts'))
const MarketLayout = lazy(() => import('./pages/MarketLayout'))
const MarketSettings = lazy(() => import('./pages/MarketSettings'))
const Stores = lazy(() => import('./pages/Stores'))
const Trips = lazy(() => import('./pages/Trips'))
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
  // `signedIn`, not `session`: an expired token that cannot be refreshed at sea
  // reports no session, but the man has not signed out and must keep working.
  // See the note in AuthContext.
  const { signedIn, appUser, loading } = useAuth()
  const { pathname } = useLocation()
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
  if (!signedIn) {
    return <Navigate to="/login" replace />
  }

  // Route-level gating, driven off the same table that builds the menu. This is
  // convenience, not security — RLS in supabase/engineer_role.sql is what
  // actually stops an engineer reading the sales tables. What this prevents is
  // a page of empty cards and a stack of console errors when someone follows an
  // old link or types a URL.
  //
  // A route the menu does not list returns null: allowed for everyone except an
  // engineer, so an unlisted page fails towards the tighter role.
  // "/" is never blocked here. It is the app's front door, and RoleHome decides
  // where each role actually lands — an engineer goes to his logs. Guarding it
  // like any other route meant he opened the app, got "Not available on your
  // login", and had to find the menu himself. The dashboard behind it is still
  // skipper-only; RoleHome is what enforces that.
  const access = pathname === '/' ? null : accessForPath(pathname)
  const permitted = pathname === '/' ? true
    // An unlisted route fails towards the TIGHTER role: denied to both the
    // officer and the cook, allowed to everyone else.
    : access === null ? !isOfficer(appUser) && !isCook(appUser)
    : canSee(access, appUser)
  if (appUser && !permitted) {
    return (
      <AppShell>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Not available on your login</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            Your account does not have access to this page. If you think it should, ask your skipper.
          </p>
        </div>
      </AppShell>
    )
  }
  return children
}

// The dashboard is built entirely from sales, quota and settlement figures, all
// of which an engineer is denied at the database. Rendering it for him would
// give a page of empty cards and a "no data" for every panel, so send him to
// the log he signed in to keep. Also catches "*", which redirects here.
function RoleHome() {
  const { appUser } = useAuth()
  if (isOfficer(appUser)) return <Navigate to="/engine-room" replace />
  // Same reasoning for the cook: the dashboard is sales, quota and settlement,
  // every one of which he is denied at the database. Send him to his list.
  if (isCook(appUser)) return <Navigate to="/stores" replace />
  return <Dashboard />
}

function PublicOnly({ children }) {
  const { signedIn, loading } = useAuth()
  if (loading) return null
  if (signedIn) return <Navigate to="/" replace />
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
            <RoleHome />
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
        <Route path="/market-layout" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <MarketLayout />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/trips" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Trips />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/stores" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Stores />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/market-rules" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <MarketSettings />
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
        <Route path="/reconcile" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Reconcile />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/activity" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Activity />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/buyer-league" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <BuyerLeague />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/garbage-log" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <GarbageLog />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/familiarisation" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Familiarisation />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/fuel-log" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <FuelLog />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/gear" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <GearLog />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/vessel-certs" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <VesselCerts />
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
        <Route path="/engine-room" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <EngineerHome />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/maintenance" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Maintenance />
            </Suspense>
          </ProtectedRoute>
        } />
        <Route path="/parts" element={
          <ProtectedRoute>
            <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--grey-400)' }}>Loading…</div>}>
              <Parts />
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
