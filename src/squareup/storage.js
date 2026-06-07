const ROSTER_KEY = 'squareup_roster_v1';
const TRIP_KEY = 'squareup_trip_v1';
const FOREIGN_ROSTER_KEY = 'squareup_foreign_roster_v1';

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

export const loadTrip = () => safeGet(TRIP_KEY, null);
export const saveTrip = (t) => safeSet(TRIP_KEY, t);
