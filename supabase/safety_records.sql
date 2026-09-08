-- RISK ASSESSMENTS, AND LIFTING AND WORK EQUIPMENT.
-- Applied Sep 2026 as migration `risk_assessments_and_lifting_equipment`.
--
-- David: "do risk assesments and lolar/pular next. risk assesments require
-- annual reviewing."
--
-- THESE ARE THE FIRST CERTIFICATION RECORDS THE APP CAN ACTUALLY BE. The Oil
-- Record Book and the Official Log Book are prescribed statutory books with no
-- approval route, so both pages tell the skipper the paper is still the record.
-- These are different: reg 7 of the MS&FV (Health and Safety at Work)
-- Regulations 1997 prescribes NO FORM at all, and MGN 332 says a thorough
-- examination report may be held "electronically or on computer disc, provided
-- that the information is in a form which is usable by the shipowner and
-- employer or master". No paper twin, nothing to keep in step, no banner.
--
-- THE STATUTE HAS NO ANNUAL REVIEW. Reg 7(3) triggers a review where the
-- assessment "may no longer be valid" or there has been "a significant change"
-- -- events, not a calendar. The annual cycle is DAVID'S regime and lives in
-- review_due, the same distinction the Official Log Book draws between what
-- the Schedule prescribes and how often this boat holds a drill.
--
-- SIX AGAINST TWELVE IS THE THING PEOPLE GET BACKWARDS. LOLER reg 12(2): at
-- least every SIX months for lifting equipment used to lift PERSONS and for
-- lifting ACCESSORIES, at least every TWELVE for other lifting equipment, or
-- to an examination scheme. It is the crane at twelve that is the exception,
-- not the sling at six.
--
-- AND LOLER DOES APPLY TO FISHING VESSELS. Reg 12(7) reads like an exclusion
-- in summary and is a TRANSITIONAL provision for equipment examined under the
-- 1988 Hatches and Lifting Plant Regulations. Checked against the statute
-- rather than a summary, because building the wrong duty would have told the
-- skipper something false about the law.
--
-- PUWER PRESCRIBES NO INTERVAL. Reg 6 says inspection "at suitable intervals",
-- so there is no statutory figure and defaulting to one would dress a guess as
-- a duty. A PUWER item is chased only where the boat has set a scheme.
--
-- Probed as an officer and a cook: the mate writes assessments, hazards,
-- briefings, equipment and examinations, and MAY correct them -- unlike the two
-- statutory books, these are working documents. A made-up equipment kind and a
-- likelihood outside 1-5 are both refused. The cook reads 0 and 0 and cannot
-- write.
--
-- All five tables are in officer_role.sql's allow-list -- the deny loop and the
-- 2b cleanup -- and NOT in its officer_works loop, because their own policies
-- above already grant him exactly what he should have.

-- See src/lib/certification/safety.js for the rules these columns exist to
-- support, and scripts/safety-preview.mjs for the states they render in.

create table if not exists public.risk_assessments (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id     uuid,
  ref           text,
  title         text not null,
  area          text,
  assessed_on   date not null,
  assessed_by   text not null,
  review_due    date,
  -- A REVIEW MAKES A NEW ASSESSMENT AND POINTS THE OLD ONE AT IT. Nothing is
  -- edited: what the crew were briefed on last year is what they were briefed
  -- on, and an assessment quietly rewritten afterwards cannot be relied on to
  -- say what was in force at the time of an accident.
  supersedes_id uuid references public.risk_assessments(id),
  withdrawn_on  date,
  withdrawn_why text,
  notes         text,
  created_at    timestamptz not null default now(),
  constraint ra_title_said check (length(btrim(title)) > 2),
  constraint ra_assessor_named check (length(btrim(assessed_by)) > 1),
  constraint ra_review_after check (review_due is null or review_due >= assessed_on),
  constraint ra_vessel_fleet_fk foreign key (vessel_id, fleet_id)
    references public.vessels (id, fleet_id)
);

create table if not exists public.risk_assessment_hazards (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  assessment_id uuid not null references public.risk_assessments(id) on delete cascade,
  hazard        text not null,
  who_at_risk   text,
  controls      text,
  -- 1-5 each. The PRODUCT is not stored: a rating is derived, and storing it
  -- would let the score and its two factors drift apart -- the same reason the
  -- parts ledger has no on_hand column.
  likelihood    int check (likelihood between 1 and 5),
  severity      int check (severity between 1 and 5),
  further_action text,
  action_by     text,
  action_due    date,
  done_on       date,
  sort          int not null default 0,
  constraint rah_hazard_said check (length(btrim(hazard)) > 2)
);

-- "THE SIGNIFICANT FINDINGS ... SHALL BE BROUGHT TO THE NOTICE OF WORKERS."
-- A duty in its own right, and nothing else in this app records it. An
-- assessment nobody was told about is not compliance, however well written.
create table if not exists public.risk_assessment_briefings (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  assessment_id uuid not null references public.risk_assessments(id) on delete cascade,
  briefed_on    date not null,
  crew_name     text not null,
  briefed_by    text,
  constraint rab_named check (length(btrim(crew_name)) > 1)
);

create index if not exists ra_fleet_idx on public.risk_assessments (fleet_id, review_due);
create index if not exists rah_assessment_idx on public.risk_assessment_hazards (assessment_id, sort);
create index if not exists rab_assessment_idx on public.risk_assessment_briefings (assessment_id);

create table if not exists public.work_equipment (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id     uuid,
  name          text not null,
  -- WHAT IT IS DECIDES HOW OFTEN IT IS EXAMINED. This field carries the whole
  -- of reg 12(2), and getting it the wrong way round is a real failure.
  kind          text not null check (kind in ('loler_persons','loler_accessory','loler_other','puwer')),
  identifier    text,
  swl           text,
  location      text,
  in_service_on  date,
  out_of_service_on date,
  -- An examination scheme drawn up by a competent person may set a different
  -- interval. Null means the statutory one for its kind.
  scheme_months int check (scheme_months between 1 and 60),
  scheme_by     text,
  notes         text,
  created_at    timestamptz not null default now(),
  constraint we_name_said check (length(btrim(name)) > 1),
  constraint we_vessel_fleet_fk foreign key (vessel_id, fleet_id)
    references public.vessels (id, fleet_id)
);

create table if not exists public.equipment_examinations (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  equipment_id  uuid not null references public.work_equipment(id) on delete cascade,
  examined_on   date not null,
  kind          text not null default 'thorough'
                check (kind in ('thorough','inspection','test','exceptional')),
  -- Reports are "authenticated by the person making the thorough examination".
  -- A NAME, because a competent person is usually a specialist firm's engineer
  -- with no login here.
  competent_person text not null,
  organisation  text,
  result        text not null default 'satisfactory'
                check (result in ('satisfactory','defects','unsafe')),
  defects       text,
  -- WHAT THE REPORT SAYS, not what the statute allows. The statutory latest is
  -- worked out separately and a report claiming a longer gap is REPORTED
  -- rather than corrected -- same rule as net + VAT against a printed total.
  next_due      date,
  report_ref    text,
  file_path     text,
  recorded_by   uuid references public.app_users(id),
  recorded_at   timestamptz not null default now(),
  constraint ee_person_named check (length(btrim(competent_person)) > 1)
);

create index if not exists ee_equipment_idx on public.equipment_examinations (equipment_id, examined_on desc);

-- RLS, in one loop over the five tables. A new table is open to every tenant
-- from the moment it exists unless the restrictive fleet policy is written
-- first, because none of the permissive policies in this database carries a
-- fleet check of its own.
--
-- Read is an ALLOW-LIST OF ROLES, so a role added later sees nothing until
-- somebody decides it should. Write is the mate as well as the skipper: he is
-- the man doing the job being assessed and the inspection being recorded, and
-- if writing it down needs somebody else to sign in, it does not get written
-- down. Unlike the two statutory books these MAY be corrected -- they are
-- working documents, and a typo in a control measure should be fixed rather
-- than superseded by a whole new assessment.
do $$
declare t text;
begin
  foreach t in array array['risk_assessments','risk_assessment_hazards',
                           'risk_assessment_briefings','work_equipment',
                           'equipment_examinations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists fleet_isolation_%s on public.%I', t, t);
    execute format(
      'create policy fleet_isolation_%s on public.%I as restrictive for all to authenticated '
      'using (fleet_id = current_fleet_id()) with check (fleet_id = current_fleet_id())', t, t);

    execute format('drop policy if exists %s_read on public.%I', t, t);
    execute format(
      'create policy %s_read on public.%I for select to authenticated using (exists ('
      'select 1 from public.app_users u where u.id = auth.uid() '
      'and u.role in (''skipper'',''viewer'',''officer'',''engineer'')))', t, t);

    execute format('drop policy if exists %s_write on public.%I', t, t);
    execute format(
      'create policy %s_write on public.%I for all to authenticated using (exists ('
      'select 1 from public.app_users u where u.id = auth.uid() '
      'and u.role in (''skipper'',''officer'',''engineer''))) with check (exists ('
      'select 1 from public.app_users u where u.id = auth.uid() '
      'and u.role in (''skipper'',''officer'',''engineer'')))', t, t);

    execute format('drop trigger if exists audit_%s on public.%I', t, t);
    execute format(
      'create trigger audit_%s after insert or update or delete on public.%I '
      'for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;
