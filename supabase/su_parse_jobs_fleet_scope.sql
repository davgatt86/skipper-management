/* THE READER'S JOB TABLE IS SCOPED BY FLEET AT LAST — Sep 2026.
 *
 * `su_parse_jobs` carries the text the AI reader extracts from a settling
 * sheet, an invoice bundle or a certificate scan, and it has been readable by
 * EVERY LOGIN ON THE SETTLEMENTS ALLOW-LIST since it was built — Audacious,
 * Beryl and the demo. Beryl's skipper could read a job holding Audacious's
 * crew wages, which is the agent grant running backwards: David holds a
 * one-way read over Beryl, and never Beryl over him.
 *
 * `su_fleet_isolation.sql` left it alone deliberately and said why: the edge
 * function inserts with the SERVICE-ROLE KEY, where `current_fleet_id()` is
 * null, so a fleet check would have hidden every row from the client that
 * polls for it. The column to fix that has existed since that migration and
 * NOTHING HAD EVER SET IT — 0 rows carried a fleet.
 *
 * So the function is deployed FIRST (v14) writing `fleet_id` from the caller's
 * own JWT, and this runs second. In that order there is no moment when a job
 * cannot be collected: while the old policy stood the new rows were already
 * being stamped.
 *
 * A row left from before this carries no fleet and is now invisible to
 * everyone. That is correct and costs nothing — a job is transient working
 * state, the function deletes anything over 24 hours old on its next call, and
 * the result has long since been saved or discarded by the page.
 *
 * AND IT FIXES A LIMITATION IN THE SAME BREATH. The allow-list held three
 * logins out of fifteen, so a skipper off it watched the poll find nothing for
 * six minutes and then be told the read had timed out. The boundary is now the
 * fleet, which is the boundary every other table in this app uses, so the
 * reader works for every boat that has a login.
 */

drop policy if exists su_parse_jobs_read on public.su_parse_jobs;

create policy su_parse_jobs_read on public.su_parse_jobs
  for select to authenticated
  using (fleet_id = public.current_fleet_id());

/* Belt and braces, and the house pattern: a permissive policy plus a
   RESTRICTIVE one, so a permissive policy written here in a year cannot open
   the table by itself. The officer and cook denies stand alongside these —
   a settling sheet is money, and both roles are refused every money table. */
drop policy if exists fleet_isolation on public.su_parse_jobs;

create policy fleet_isolation on public.su_parse_jobs
  as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id());
