-- ============================================================
-- ANNUAL SELF-CERTIFICATION — the working record behind MSF 1323.
--
-- Audacious is 23.96 m REGISTERED length (29.80 m LOA), so she is in the
-- 15 m LOA to under 24 m RL band: a UK Fishing Vessel Certificate, an MCA
-- inspection between 24 and 36 months, and an annual self-certification in
-- the years between. The checklist worked through is MSF 5550, the MCA's own
-- aide memoire for that band, which the app ships in code.
--
-- THIS IS THE WORKING PAPER, NOT THE FORM. MSF 1323 is the declaration the
-- skipper signs and returns; what is stored here is the aide memoire worked
-- through, item by item, with who answered each one and when.
--
-- WHY IT IS AUDITED. A book kept by hand, a few entries at a time, where a
-- silent change would matter — which is exactly the test in CLAUDE.md for
-- which tables belong in the audit trail. It is also the one record here that
-- somebody outside the business may one day read.
-- ============================================================

create table if not exists public.self_certifications (
  id             uuid primary key default gen_random_uuid(),
  fleet_id       uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  -- REQUIRED, not nullable-and-backfilled: a self-certification is about one
  -- hull, and a pair team has two. Same argument as the gear log.
  vessel_id      uuid not null,
  -- The certificate year this belongs to, named by the anniversary it follows
  -- ("2026/27"). Not a calendar year — it hangs off the UKFVC anniversary.
  period         text not null,
  -- THE REVISION IS PART OF THE RECORD. "The vessel complied" means nothing
  -- without the list it complied with, and the MCA revises this form.
  form_code      text not null default 'MSF 5550',
  form_revision  text not null default '09.24',
  -- Copied in at the time rather than joined at read: the certificate can be
  -- renewed, and this must still say what year it was answering for.
  cert_issued_on date,
  started_at     timestamptz not null default now(),
  -- Null until it is signed off. A part-finished check is not a certification.
  completed_at   timestamptz,
  declared_by    uuid references public.app_users(id),
  declared_name  text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint self_certifications_vessel_fleet_fk
    foreign key (vessel_id, fleet_id) references public.vessels(id, fleet_id),
  -- One per boat per certificate year. Doing it twice is not a thing.
  constraint self_certifications_one_per_period unique (vessel_id, period)
);

create table if not exists public.self_certification_items (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  self_cert_id uuid not null references public.self_certifications(id) on delete cascade,
  -- The MSF 5550 item number, 1-148. Kept as the FORM's number so a row can be
  -- read against the paper without a lookup.
  item_n      int not null,
  -- yes complied · no not complied · na does not apply to this vessel.
  -- There is no "unanswered" value: an unanswered item has NO ROW. Nought and
  -- never-recorded must not read alike, and a null state would be a third
  -- spelling of the same thing.
  state       text not null check (state in ('yes','no','na')),
  note        text,
  answered_by uuid references public.app_users(id),
  answered_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint self_certification_items_one_per_item unique (self_cert_id, item_n),
  constraint self_certification_items_n_range check (item_n between 1 and 999)
);

create index if not exists self_certifications_fleet_idx on public.self_certifications (fleet_id);
create index if not exists self_certifications_vessel_idx on public.self_certifications (vessel_id, period);
create index if not exists self_certification_items_cert_idx on public.self_certification_items (self_cert_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.self_certifications to authenticated;
grant select, insert, update, delete on public.self_certification_items to authenticated;

alter table public.self_certifications enable row level security;
alter table public.self_certification_items enable row level security;

-- The restrictive half. A new table is open to every tenant until this exists,
-- so it goes on before anything else.
create policy fleet_isolation_self_certifications on public.self_certifications
  as restrictive for all
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

create policy fleet_isolation_self_certification_items on public.self_certification_items
  as restrictive for all
  using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id());

-- ---- Who may do what -------------------------------------------------------
-- THE MATE WORKS THROUGH IT; THE SKIPPER SIGNS IT. An officer keeps the
-- records — that is the whole reason the role exists — and answering 148
-- checks is record-keeping. The DECLARATION is not: it is a statement about
-- the vessel made by the person answerable for her, so completing a
-- certification is skipper-only and enforced below rather than in the page.
--
-- The cook is denied by not appearing here at all, which is how cook_role.sql
-- denies everything else. He needs no explicit rule.

create policy self_cert_read on public.self_certifications for select
  using (exists (select 1 from app_users u where u.id = auth.uid()
                  and u.role = any (array['skipper'::user_role,'viewer'::user_role,
                                          'officer'::user_role,'engineer'::user_role])));

create policy self_cert_ins on public.self_certifications for insert
  with check (exists (select 1 from app_users u where u.id = auth.uid()
                       and u.role = any (array['skipper'::user_role,'officer'::user_role,'engineer'::user_role]))
              and completed_at is null);

-- An officer may keep it up to date but may NOT sign it off: any update that
-- sets completed_at has to come from a skipper. Written as two policies rather
-- than one so the refusal is on the act of completing, not on touching the row.
create policy self_cert_upd_officer on public.self_certifications for update
  using (exists (select 1 from app_users u where u.id = auth.uid()
                  and u.role = any (array['officer'::user_role,'engineer'::user_role]))
         and completed_at is null)
  with check (completed_at is null);

create policy self_cert_upd_skipper on public.self_certifications for update
  using (exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'skipper'::user_role))
  with check (exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'skipper'::user_role));

create policy self_cert_del on public.self_certifications for delete
  using (exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'skipper'::user_role));

create policy self_cert_items_read on public.self_certification_items for select
  using (exists (select 1 from app_users u where u.id = auth.uid()
                  and u.role = any (array['skipper'::user_role,'viewer'::user_role,
                                          'officer'::user_role,'engineer'::user_role])));

-- Answers may not be changed once the certification is signed off. That is the
-- nearest this schema gets to MGN 690's "entries shall be protected from
-- deletion", and it is enforced here rather than in the page because the page
-- is not the boundary.
create policy self_cert_items_write on public.self_certification_items for all
  using (exists (select 1 from app_users u where u.id = auth.uid()
                  and u.role = any (array['skipper'::user_role,'officer'::user_role,'engineer'::user_role]))
         and exists (select 1 from public.self_certifications c
                      where c.id = self_cert_id and c.completed_at is null))
  with check (exists (select 1 from app_users u where u.id = auth.uid()
                       and u.role = any (array['skipper'::user_role,'officer'::user_role,'engineer'::user_role]))
              and exists (select 1 from public.self_certifications c
                           where c.id = self_cert_id and c.completed_at is null));

-- ---- The audit trail -------------------------------------------------------
drop trigger if exists audit_self_certifications on public.self_certifications;
create trigger audit_self_certifications
  after insert or update or delete on public.self_certifications
  for each row execute function public.audit_trigger();

drop trigger if exists audit_self_certification_items on public.self_certification_items;
create trigger audit_self_certification_items
  after insert or update or delete on public.self_certification_items
  for each row execute function public.audit_trigger();

-- NOTE FOR WHOEVER ADDS THE NEXT TABLE: officer_role.sql carries its allow-list
-- THREE times and cook_role.sql once more. These two tables are handled by the
-- explicit policies above instead, so neither file needs re-running for them —
-- but anything added later still does.
