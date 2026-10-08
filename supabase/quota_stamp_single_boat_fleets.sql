/* A QUOTA STATEMENT WITH NO BOAT ON IT WAS INVISIBLE TO ITS OWN FLEET. Oct 2026.
 * Applied as migration quota_stamp_single_boat_fleets.
 *
 * David: *"reset quota to upload a fresh sheet, and this is the message i get"*
 * — the Position table reading *"Nothing to show — add a stock, or upload an
 * AFPO statement and trip reports"* directly under a banner saying
 * *"Current_Quota_Holdings.xlsx: this statement (2026, updated 07/10/2026) is
 * already loaded"*.
 *
 * BOTH HALVES OF THE SCREEN WERE TELLING THE TRUTH. The statement was on file
 * with its 63 stocks, and the boat filter was dropping it before it reached the
 * table. Two faults meeting:
 *
 *   1. `uploadAfpo` never wrote `vessel_id` — nothing on the quota page did.
 *   2. `scopeRows` filtered on `vessel_id` even for a fleet with ONE boat, over
 *      a comment calling that harmless because filtering by the only boat is the
 *      same as not filtering. **It is the same only where every row carries the
 *      boat.** Audacious has one boat, so the filter could only ever lose her
 *      own rows.
 *
 * Both are fixed in the app — the page stamps the boat on every insert, and a
 * one-boat fleet now filters on nothing. This is for the row already written.
 *
 * SAME RULE AS vessel_id_backfill_after_provider.sql: a fleet with exactly one
 * boat has exactly one possible answer. A PAIR IS LEFT ALONE — Test Fleet's one
 * unstamped manual stock stays unstamped, because which half of the pair it
 * belongs to is not knowable from the row, and quota filed against the wrong
 * hull is the one mistake this page must never make. HANSTHOLM has no boat at
 * all to point at, so its 4 rota trips stay null for good.
 *
 * `(array_agg(id))[1]` rather than `min(id)`: there is no min() for uuid, and
 * the group holds exactly one row by the HAVING.
 *
 * Result: 1 snapshot stamped (Audacious's 2026 statement, 63 stocks), 0 trips,
 * 0 manual stocks. Nothing else in the database was unstamped.
 */
with one_boat as (
  select v.fleet_id, (array_agg(v.id))[1] as vessel_id
    from public.vessels v
   where v.active is not false
   group by v.fleet_id
  having count(*) = 1)
update public.quota_snapshots s
   set vessel_id = b.vessel_id
  from one_boat b
 where b.fleet_id = s.fleet_id and s.vessel_id is null;

with one_boat as (
  select v.fleet_id, (array_agg(v.id))[1] as vessel_id
    from public.vessels v
   where v.active is not false
   group by v.fleet_id
  having count(*) = 1)
update public.quota_trips t
   set vessel_id = b.vessel_id
  from one_boat b
 where b.fleet_id = t.fleet_id and t.vessel_id is null;

with one_boat as (
  select v.fleet_id, (array_agg(v.id))[1] as vessel_id
    from public.vessels v
   where v.active is not false
   group by v.fleet_id
  having count(*) = 1)
update public.quota_manual_stocks m
   set vessel_id = b.vessel_id
  from one_boat b
 where b.fleet_id = m.fleet_id and m.vessel_id is null;
