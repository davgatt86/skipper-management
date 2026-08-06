const ROSTER_KEY = 'squareup_roster_v1';
const FOREIGN_ROSTER_KEY = 'squareup_foreign_roster_v1';

// Trip shape changed when haulage became rows and labour gained a rate basis.
// v1 is READ but never written and never deleted: if this build is rolled back,
// the old page finds its data exactly where it left it.
const TRIP_KEY_V1 = 'squareup_trip_v1';
const TRIP_KEY = 'squareup_trip_v2';

const safeGet = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};

const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Storage write failed:', e);
  }
};

export const loadRoster = () => {
  const r = safeGet(ROSTER_KEY, []);
  return Array.isArray(r) ? r : [];
};
export const saveRoster = (r) => safeSet(ROSTER_KEY, r);

export const loadForeignRoster = () => {
  const r = safeGet(FOREIGN_ROSTER_KEY, []);
  return Array.isArray(r) ? r : [];
};
export const saveForeignRoster = (r) => safeSet(FOREIGN_ROSTER_KEY, r);

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Bring a v1 trip forward.
 *
 * logistics was one free-text box ("Trucks, company, where, when..."). There is
 * no way to split that into haulier/from/loads without guessing, so it is kept
 * verbatim as a note under the new section. Nothing typed is lost, and nothing
 * is invented.
 *
 * labour rows had a name, optional boxes and a total. Whether that total was a
 * per-box calculation or a flat price is not recorded, so they come across as
 * flat at exactly the amount already there — the figure does not move.
 */
function migrateV1(t) {
  if (!t) return null;
  return {
    ...t,
    haulage: Array.isArray(t.haulage) ? t.haulage : [],
    haulageNote: t.haulageNote ?? (typeof t.logistics === 'string' ? t.logistics : ''),
    labour: (t.labour || []).map((l) => ({
      id: l.id || uid(),
      name: l.name || '',
      basis: l.basis || 'flat',
      boxes: l.boxes ?? '',
      rate: l.rate ?? (l.amount ?? ''),
      amount: l.amount ?? '',
    })),
    migratedFrom: t.migratedFrom || 'v1',
  };
}

export const loadTrip = () => {
  const v2 = safeGet(TRIP_KEY, null);
  if (v2) return v2;
  // First run on this device after the change — bring v1 forward, leave it in place.
  const v1 = safeGet(TRIP_KEY_V1, null);
  return v1 ? migrateV1(v1) : null;
};

export const saveTrip = (t) => safeSet(TRIP_KEY, t);

// Only for the "start a new trip" button — clears the working copy without
// touching v1, which stays as the pre-change backup.
export const clearTrip = () => {
  try { localStorage.removeItem(TRIP_KEY); } catch { /* ignore */ }
};

// True when a v1 trip exists that has not been superseded yet — lets the page
// say where the carried-over note came from.
export const hasLegacyTrip = () => safeGet(TRIP_KEY, null) == null && safeGet(TRIP_KEY_V1, null) != null;
