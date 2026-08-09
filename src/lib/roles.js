// Who is allowed to do what, in one place.
//
// These helpers decide what the UI OFFERS. They are not the security boundary —
// the Supabase anon key ships in the bundle, so anyone with a login can query
// the database directly and never touch this file. The boundary is the RLS in
// `supabase/engineer_role.sql`, which denies engineers every table except the
// four logs by way of an allow-list.
//
// Keep the two in step. If they drift, the symptom is a menu entry that opens
// an empty page — annoying, but not a leak.

export const isSkipper = (u) => u?.role === 'skipper'
export const isViewer = (u) => u?.role === 'viewer'
export const isEngineer = (u) => u?.role === 'engineer'

// Engine, fuel/oil and garbage logs are kept by whoever is aboard. The skipper
// keeps them too — adding the engineer does not take the job off him.
export const keepsLogs = (u) => ['skipper', 'engineer'].includes(u?.role)

// Where a user lands when they open the app. An engineer has no dashboard —
// every figure on it comes from sales and quota, which he cannot read — so
// send him to the log he came to keep rather than a page of empty cards.
export const homeFor = (u) => (isEngineer(u) ? '/engine-logs' : '/')

export const ROLE_LABELS = {
  skipper: 'Skipper — full access',
  viewer: 'Viewer — read only, no crew pay',
  engineer: 'Engineer — engine, fuel and garbage logs only',
}
