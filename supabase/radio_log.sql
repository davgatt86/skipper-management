-- THE RADIO LOG.
-- Applied Sep 2026 as migration `radio_log`.
--
-- The Merchant Shipping (Radio) (Fishing Vessels) Regulations 1999,
-- SI 1999/3210. Regulation 19 for a DIRECTIVE fishing vessel, regulation 25
-- for a NON-DIRECTIVE one, and the matters to be recorded are in Schedule 3.
--
-- WHICH SCHEDULE PART APPLIES IS DECIDED ON LENGTH, AND IT IS THE SAME 24 m
-- QUESTION THAT DECIDES THE SELF-CERTIFICATION BAND -- the third time that
-- figure has settled something on this boat, and the second time four
-- centimetres do it. A "Directive fishing vessel" is a NEW vessel of 24 m or
-- more, or an EXISTING one of 45 m or more, and the regulations define length
-- as about 96% of the total length on a waterline at 85% of the least moulded
-- depth: a RULE length, near the registered length and nothing like the LOA.
--
--   Part I  GMDSS Radio Log             distress, urgency AND safety traffic;
--                                       important incidents connected with the
--                                       radio service; and the position at
--                                       least once a day
--   Part II Simplified FV GMDSS Radio    distress traffic only
--
-- Audacious is 23.96 m registered and built 2022, so she is non-Directive and
-- keeps the simplified log. `radioPart()` REFUSES to answer where the record
-- cannot settle it rather than guessing -- the same refusal as `bandFor()`,
-- because a page that guessed would tell a skipper he need only log distress
-- traffic when he owes four more things.
--
-- THE SIGNATURE IS DAILY, AND THAT IS THIS BOOK'S DISTINCTIVE RULE. Both
-- regulations: "The skipper shall inspect and sign each day's entries." Not per
-- entry as in the Oil Record Book, not per page, and not with a witness as in
-- the Official Log Book -- per DAY, by the skipper, over whatever was written
-- that day. So the day is the unit that gets signed, and it is a table.
--
-- AND A DAY WITH NO ENTRIES NEEDS NO SIGNATURE. The duty is to sign "each
-- day's ENTRIES"; where there are none there is nothing to attest. Chasing
-- every quiet day would be a warning firing on the ordinary case, which is how
-- the ones that matter stop being read.

create table if not exists public.radio_log_entries (
  id           uuid primary key default gen_random_uuid(),
  fleet_id     uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id    uuid not null,
  log_date     date not null,
  -- THE TIME IS PART OF THE DUTY, not decoration. Schedule 3 asks for "the
  -- time such communications occurred" in every one of its limbs.
  occurred_at  time,
  kind         text not null check (kind in
                 ('distress','urgency','safety','incident','position','test')),
  summary      text not null,
  station      text,
  position_text text,
  recorded_by  uuid references public.app_users(id),
  recorded_at  timestamptz not null default now(),
  corrects_entry_id uuid references public.radio_log_entries(id),
  constraint rle_summary_said check (length(btrim(summary)) > 2),
  constraint rle_vessel_fleet_fk foreign key (vessel_id, fleet_id)
    references public.vessels (id, fleet_id)
);

create index if not exists rle_day_idx on public.radio_log_entries (vessel_id, log_date, occurred_at);

-- The skipper's daily signature over that day's entries.
create table if not exists public.radio_log_days (
  id           uuid primary key default gen_random_uuid(),
  fleet_id     uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id    uuid not null,
  log_date     date not null,
  signed_name  text not null,
  signed_by    uuid references public.app_users(id),
  signed_at    timestamptz not null default now(),
  constraint rld_signed_named check (length(btrim(signed_name)) > 1),
  constraint rld_one_per_day unique (vessel_id, log_date),
  constraint rld_vessel_fleet_fk foreign key (vessel_id, fleet_id)
    references public.vessels (id, fleet_id)
);


-- RLS -----------------------------------------------------------------------
alter table public.radio_log_entries enable row level security;
alter table public.radio_log_days enable row level security;

drop policy if exists fleet_isolation_radio_entries on public.radio_log_entries;
create policy fleet_isolation_radio_entries on public.radio_log_entries
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

drop policy if exists fleet_isolation_radio_days on public.radio_log_days;
create policy fleet_isolation_radio_days on public.radio_log_days
  as restrictive for all to authenticated
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

drop policy if exists radio_entries_read on public.radio_log_entries;
create policy radio_entries_read on public.radio_log_entries
  for select to authenticated using (exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role in ('skipper','viewer','officer','engineer')));

drop policy if exists radio_days_read on public.radio_log_days;
create policy radio_days_read on public.radio_log_days
  for select to authenticated using (exists (
    select 1 from public.app_users u
    where u.id = auth.uid() and u.role in ('skipper','viewer','officer','engineer')));

-- AN ENTRY MAY ONLY BE MADE ON A DAY THE SKIPPER HAS NOT YET SIGNED.
-- His signature attests that day's entries; adding to it afterwards would put
-- traffic under a signature nobody gave it.
drop policy if exists radio_entries_ins on public.radio_log_entries;
create policy radio_entries_ins on public.radio_log_entries
  for insert to authenticated with check (
    exists (select 1 from public.app_users u
            where u.id = auth.uid() and u.role in ('skipper','officer','engineer'))
    and not exists (select 1 from public.radio_log_days d
                    where d.vessel_id = radio_log_entries.vessel_id
                      and d.log_date = radio_log_entries.log_date));

-- AND MAY ONLY BE CORRECTED WHILE THAT DAY IS STILL UNSIGNED.
-- This is NOT the Official Log Book's blanket rule and it is not imported from
-- it: SI 1999/3210 says nothing about erasure. What it does say is that the
-- skipper signs each day's entries -- so what he has signed is fixed, and what
-- he has not is still the day's working record. The rule follows from the duty
-- rather than from another statute.
drop policy if exists radio_entries_fix on public.radio_log_entries;
create policy radio_entries_fix on public.radio_log_entries
  for update to authenticated
  using (exists (select 1 from public.app_users u
                 where u.id = auth.uid() and u.role in ('skipper','officer','engineer'))
         and not exists (select 1 from public.radio_log_days d
                         where d.vessel_id = radio_log_entries.vessel_id
                           and d.log_date = radio_log_entries.log_date))
  with check (not exists (select 1 from public.radio_log_days d
                          where d.vessel_id = radio_log_entries.vessel_id
                            and d.log_date = radio_log_entries.log_date));

-- THE SIGNATURE IS THE SKIPPER'S. Regs 19(2) and 25(2) name him, and the mate
-- keeping the log does not stand in for him here.
drop policy if exists radio_days_sign on public.radio_log_days;
create policy radio_days_sign on public.radio_log_days
  for insert to authenticated with check (
    exists (select 1 from public.app_users u
            where u.id = auth.uid() and u.role = 'skipper'));

-- No delete anywhere, and no update of a signed day. A signature is not
-- something to be taken back.
revoke delete on public.radio_log_entries from authenticated, anon;
revoke update, delete on public.radio_log_days from authenticated, anon;
grant select, insert, update on public.radio_log_entries to authenticated;
grant select, insert on public.radio_log_days to authenticated;

drop trigger if exists audit_radio_entries on public.radio_log_entries;
create trigger audit_radio_entries
  after insert or update or delete on public.radio_log_entries
  for each row execute function public.audit_trigger();

drop trigger if exists audit_radio_days on public.radio_log_days;
create trigger audit_radio_days
  after insert or update or delete on public.radio_log_days
  for each row execute function public.audit_trigger();


-- PROBED, not inspected -----------------------------------------------------
--   officer made an entry | officer corrected an unsigned day: 1 row |
--   officer cannot sign the day | skipper signed the day | entry on a signed
--   day refused | edit of a signed day affected 0 rows (which IS the refusal --
--   an UPDATE matching nothing succeeds silently, so the row count is the test)
--   | entry delete refused | a kind off the list refused | cook reads 0 and 0
--
-- Both tables are in officer_role.sql's allow-list -- the deny loop and the 2b
-- cleanup -- and NOT in its officer_works loop, which grants ALL and would hand
-- the mate the daily signature that belongs to the skipper.
