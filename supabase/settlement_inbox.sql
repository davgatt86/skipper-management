-- SETTLING SHEETS THAT ARRIVED BY EMAIL (Aug 2026)
--
-- David: "settling sheets. they get emailed to me now. setup auto sending to
-- page like the fish sales sheets."
--
-- THE SHEET IS FILED, NOT SAVED. That is the whole design of this table and it
-- is deliberate. A sales note is parsed by `parse-core` and reconciled against
-- its own printed total, so the webhook can file it and be sure. A settling
-- sheet is a PHOTOGRAPH read by a model -- every one of them has zero fonts and
-- no text layer at all, which is why the AI reader exists -- and the review
-- screen therefore shows each total TWICE, as printed on the sheet and as the
-- lines add up, with a difference having to be acknowledged before saving.
--
-- Auto-saving one from an email would walk straight around that. So the email
-- puts the document on the page and stops; the skipper opens it, reads the two
-- totals, and saves as he does today. What is removed is the hunting for the
-- attachment, not the checking.
--
-- ONE ROW PER ARRIVAL, not per settlement. The same sheet emailed twice lands
-- twice and both are shown; deciding they are the same document is the
-- skipper's, because `su_settlements` is unique on (boat_id, reference) and the
-- reference only exists once the sheet has been read.

create table if not exists public.su_inbox (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null references public.fleets(id) on delete cascade,
  boat_id       uuid references public.su_boats(id) on delete set null,

  file_path     text not null,             -- in the su-documents bucket
  filename      text,
  bytes         integer,

  -- Who sent it, kept as it arrived. Don Fishing send these and it is usually
  -- Morna but "it might not always be from morna" -- so the address is a
  -- record of what happened, never a gate. The gate is `ingest_senders`.
  from_email    text,
  subject       text,
  received_at   timestamptz not null default now(),

  status        text not null default 'new'
                  check (status in ('new', 'imported', 'ignored')),
  -- Set when the skipper turns it into a settlement, so the arrival and the
  -- record it became stay tied together.
  settlement_id uuid references public.su_settlements(id) on delete set null,
  note          text,

  created_at    timestamptz not null default now()
);

create index if not exists su_inbox_fleet_status_idx on public.su_inbox (fleet_id, status, received_at desc);

alter table public.su_inbox enable row level security;

-- The su_* model: boat visibility, which is fleet-scoped through su_boats plus
-- any explicit agent grant. Same shape as su_settlements itself.
drop policy if exists su_inbox_visible on public.su_inbox;
create policy su_inbox_visible on public.su_inbox
  for all to authenticated
  using (boat_id is null or public.su_visible_boat(boat_id))
  with check (boat_id is null or public.su_visible_boat(boat_id));

-- A settling sheet is MONEY. The officer and the cook are denied every money
-- table and that denial is the entire reason those roles exist rather than
-- handing out a skipper login.
drop policy if exists officer_no_access on public.su_inbox;
create policy officer_no_access on public.su_inbox
  as restrictive for all to authenticated
  using (not (select public.is_officer())) with check (not (select public.is_officer()));

drop policy if exists cook_no_access on public.su_inbox;
create policy cook_no_access on public.su_inbox
  as restrictive for all to authenticated
  using (not (select public.is_cook())) with check (not (select public.is_cook()));

-- A new table is open to every tenant until it carries the fleet check. That
-- rule is written down because it has bitten before.
drop policy if exists fleet_isolation on public.su_inbox;
create policy fleet_isolation on public.su_inbox
  as restrictive for all to authenticated
  using (fleet_id = (select public.current_fleet_id()))
  with check (fleet_id = (select public.current_fleet_id()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.su_inbox to authenticated;
