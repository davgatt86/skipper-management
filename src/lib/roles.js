// Who is allowed to do what, in one place.
//
// These helpers decide what the UI OFFERS. They are not the security boundary —
// the Supabase anon key ships in the bundle, so anyone with a login can query
// the database directly and never touch this file. The boundary is the RLS in
// `supabase/officer_role.sql`, which denies officers every table except an
// explicit allow-list.
//
// Keep the two in step. If they drift, the symptom is a menu entry that opens
// an empty page — annoying, but not a leak.

export const isSkipper = (u) => u?.role === 'skipper'
export const isViewer = (u) => u?.role === 'viewer'

// OFFICER: a working ticket for anyone aboard who keeps records — engineer,
// mate — but who has no business in the money. `engineer` is the old name for
// the same thing and is still accepted so an unmigrated login keeps working.
export const isOfficer = (u) => ['officer', 'engineer'].includes(u?.role)

// COOK: the provisions list and nothing else. A narrow role on purpose — he is
// not denied the money because he is untrusted, but because a login that can
// only do one job cannot be used for another by accident.
export const isCook = (u) => u?.role === 'cook'

// Stores are kept by the cook, and by the skipper — adding the cook does not
// take the job off him, the same way the officer did not take the logs off him.
export const keepsStores = (u) => isSkipper(u) || isCook(u)

// The logs and the maintenance record are kept by whoever is aboard. The
// skipper keeps them too — adding the officer does not take the job off him.
export const keepsLogs = (u) => isSkipper(u) || isOfficer(u)

// Crew paperwork: adding a man, filing his tickets, producing the crew list.
// Deliberately the same set — a mate doing the crew list needs the crew records
// it is built from.
export const keepsCrewRecords = (u) => isSkipper(u) || isOfficer(u)

// Where a user lands when they open the app. The main dashboard is built from
// sales and quota, which an officer cannot read, so he gets his own front page.
export const homeFor = (u) => (isOfficer(u) ? '/engine-room' : isCook(u) ? '/stores' : '/')

export const ROLE_LABELS = {
  skipper: 'Skipper — full access',
  viewer: 'Viewer — read only, no crew pay',
  officer: 'Officer — logs, maintenance and crew papers. No money.',
  engineer: 'Officer (old name) — same access',
  cook: 'Cook — the stores list only. No money, no crew, no logs.',
}
