/* THE INSPECTION PACK FOR THE MATE — one table, and a read-only one.
 *
 * The pack reads NINETEEN tables and refuses to build if any one read fails,
 * deliberately: an empty book and a shut one must never print alike to a
 * surveyor. `crew_familiarisation` was the only one of the nineteen the officer
 * was denied, so that single denial withheld the whole document from the man who
 * keeps most of what is in it.
 *
 * DROPPING THE DENIAL IS NOT ENOUGH ON ITS OWN, which is the trap here. Most
 * tables in this database carry a permissive policy of the shape
 * `to authenticated using (true)`, with only the restrictive fleet check beside
 * it — so lifting `officer_no_access` is all it takes. This table does not: its
 * read policy is an ALLOW-LIST OF ROLES (skipper, viewer). Lifting the denial
 * alone would have left him reading nothing and the pack still refusing, with
 * every policy looking correct.
 *
 * He reads it and never signs one off. That half is section 3's shape —
 * restrictive insert/update/delete denies — and it is why `crew_familiarisation`
 * is deliberately NOT in the `officer_works` loop, which grants ALL.
 *
 * `officer_role.sql` carries all three of these changes as well, so a future
 * re-run of that file keeps this state instead of undoing it. This file is the
 * targeted version, because re-running the whole thing rewrites policies across
 * ~109 tables on a live multi-tenant database to change one.
 */

drop policy if exists engineer_no_access on public.crew_familiarisation;
drop policy if exists officer_no_access on public.crew_familiarisation;

drop policy if exists officer_reads_familiarisation on public.crew_familiarisation;
create policy officer_reads_familiarisation on public.crew_familiarisation
  for select to authenticated
  using ((select public.is_officer()));

drop policy if exists officer_read_only_ins on public.crew_familiarisation;
drop policy if exists officer_read_only_upd on public.crew_familiarisation;
drop policy if exists officer_read_only_del on public.crew_familiarisation;

create policy officer_read_only_ins on public.crew_familiarisation as restrictive
  for insert to authenticated with check (not (select public.is_officer()));
create policy officer_read_only_upd on public.crew_familiarisation as restrictive
  for update to authenticated using (not (select public.is_officer()))
  with check (not (select public.is_officer()));
create policy officer_read_only_del on public.crew_familiarisation as restrictive
  for delete to authenticated using (not (select public.is_officer()));
