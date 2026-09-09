-- crew_ranks: RLS on, read for anyone signed in, writes revoked.
--
-- Raised by the Supabase security advisor, 06-09-2026: the last table in
-- `public` with row-level security disabled.
--
-- THE ADVISOR'S WORDING OVERSTATES IT AND THE REAL HOLE IS STILL REAL.
-- It says "anyone with your project URL can read, edit, and delete all data in
-- this table". Measured: `anon` holds no privilege on it at all — SELECT,
-- INSERT, UPDATE and DELETE are all false — so an unauthenticated visitor
-- holding the publishable key gets nothing. What is true is that **every
-- signed-in user of every fleet** could write it: authenticated held INSERT,
-- UPDATE and DELETE on a table with RLS off and no policies.
--
-- THE READ IS DELIBERATE AND IS UNCHANGED. `crew_ranks` is a global lookup of
-- ten rank codes with no `fleet_id` and nothing tenant-specific in it, and
-- three pages read it — Crew, Crew Details and Crew List — so that a man's rank
-- comes off a pick-list rather than a text box. That is the whole point of it:
-- Aegir keys off a typed name and carries "Captain" and "Master" for one rank.
--
-- THE WRITE WAS NEVER DELIBERATE, and UPDATE is the dangerous half rather than
-- DELETE. `crew.rank_code` references this table, so the seven codes in use are
-- held by the foreign key — but **bosun, other and trainee are unused and could
-- simply be deleted**, and nothing at all stopped any signed-in user relabelling
-- `master`. There is one row per rank for the whole database, so one user's edit
-- would change every fleet's pick-list at once, and that label prints on the
-- **IMO FAL 5 crew list** — a border document.
--
-- Nothing in the app writes it: three `.select()` calls and no insert, update or
-- delete anywhere in `src/` or `netlify/`. It is a shipped lookup, changed by
-- migration, exactly like `orb_items` and `olb_items` — and this brings it onto
-- the same shape they already use: RLS on, one SELECT policy, writes revoked at
-- the grant so it takes two mistakes rather than one to re-open them.
--
-- A POLICY THAT DOES NOT EXIST IS NOT A LOCK, and neither is a revoked grant on
-- its own. Supabase's default ACL grants `arwdDxtm` to `authenticated` on every
-- new table in `public`, which is how this table got its write privileges in the
-- first place — nobody granted them.

alter table public.crew_ranks enable row level security;

drop policy if exists crew_ranks_read on public.crew_ranks;
create policy crew_ranks_read on public.crew_ranks
  for select to authenticated
  using (auth.uid() is not null);

revoke insert, update, delete on public.crew_ranks from anon, authenticated;

-- `anon` has nothing today. Naming it here is against a later
-- `grant ... on all tables in schema public`, which would hand it the lot back.
grant select on public.crew_ranks to authenticated;
