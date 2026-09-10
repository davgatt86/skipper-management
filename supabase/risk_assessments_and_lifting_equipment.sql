-- RISK ASSESSMENTS, AND LIFTING AND WORK EQUIPMENT.
--
-- David, Sep 2026: "do risk assesments and lolar/pular next. risk assesments
-- require annual reviewing."
--
-- THESE TWO ARE THE FIRST CERTIFICATION RECORDS THE APP CAN ACTUALLY BE.
-- The Oil Record Book and the Official Log Book are prescribed statutory books
-- with no approval route, so both pages say the paper is the record. These are
-- different: reg 7 of the Merchant Shipping and Fishing Vessels (Health and
-- Safety at Work) Regulations 1997 prescribes no form at all, and MGN 332 says
-- in terms that a thorough examination report may be held "electronically or
-- on computer disc, provided that the information is in a form which is usable
-- by the shipowner and employer or master". No paper twin, nothing to keep in
-- step.

-- 1. RISK ASSESSMENTS -------------------------------------------------------
-- Reg 7: assess the risks, bring the significant findings "to the notice of
-- workers", and review the assessment where "there is reason to suspect that
-- it is no longer valid" or "there has been a significant change".
--
-- THE STATUTE HAS NO ANNUAL REVIEW. Its triggers are events, not a calendar.
-- The annual cycle is DAVID'S regime, and `review_due` is where it lives --
-- the same distinction the Official Log Book draws between what the Schedule
-- prescribes and how often this boat holds a drill.
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
  -- 1-5 each. Stored as they were judged, and the product is NOT stored: a
  -- rating is derived and storing it would let the two drift apart.
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
-- That is a duty in its own right and nothing else in this app records it. An
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


-- 2. LIFTING AND WORK EQUIPMENT ---------------------------------------------
-- LOLER (SI 2006/2184, MGN 332) and PUWER (SI 2006/2183, MGN 331). Both apply
-- to fishing vessels: reg 12(7) of LOLER looks like an exclusion and is a
-- TRANSITIONAL provision for equipment examined under the 1988 Hatches and
-- Lifting Plant Regulations. Checked against the statute rather than a summary.
create table if not exists public.work_equipment (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  vessel_id     uuid,
  name          text not null,
  -- WHAT IT IS DECIDES HOW OFTEN IT IS EXAMINED, and this is the field that
  -- carries the whole of reg 12(2): SIX months for equipment used to lift
  -- PERSONS and for lifting ACCESSORIES, TWELVE for other lifting equipment.
  -- Getting that the wrong way round is a real failure, not a cosmetic one.
  kind          text not null check (kind in ('loler_persons','loler_accessory','loler_other','puwer')),
  identifier    text,
  swl           text,
  location      text,
  in_service_on  date,
  out_of_service_on date,
  -- An "examination scheme" drawn up by a competent person may set a different
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
  -- Reg 12: reports are "authenticated by the person making the thorough
  -- examination". A name, because a competent person is usually a specialist
  -- firm's engineer with no login here.
  competent_person text not null,
  organisation  text,
  result        text not null default 'satisfactory'
                check (result in ('satisfactory','defects','unsafe')),
  defects       text,
  -- WHAT THE REPORT SAYS, not what the statute allows. The competent person
  -- states when the next examination is due; the statutory latest is worked
  -- out separately and a report claiming a longer gap is REPORTED rather than
  -- corrected. Same rule as net + VAT against the printed total.
  next_due      date,
  report_ref    text,
  file_path     text,
  recorded_by   uuid references public.app_users(id),
  recorded_at   timestamptz not null default now(),
  constraint ee_person_named check (length(btrim(competent_person)) > 1)
);

create index if not exists ee_equipment_idx on public.equipment_examinations (equipment_id, examined_on desc);


-- 3. RLS --------------------------------------------------------------------
-- A new table is open to every tenant from the moment it exists unless the
-- restrictive fleet policy is written first.
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

    -- Read: an allow-list of ROLES, so a role added later sees nothing until
    -- somebody decides it should.
    execute format('drop policy if exists %s_read on public.%I', t, t);
    execute format(
      'create policy %s_read on public.%I for select to authenticated using (exists ('
      'select 1 from public.app_users u where u.id = auth.uid() '
      'and u.role in (''skipper'',''viewer'',''officer'',''engineer'')))', t, t);

    -- Write: THE MATE KEEPS THESE. He is the man doing the inspection and
    -- writing the assessment, and if recording it needs somebody else to sign
    -- in, it does not get recorded. Unlike the two statutory books, these may
    -- be corrected -- they are working documents, not a prescribed register,
    -- and a risk assessment with a typo in a control measure should be fixed
    -- rather than superseded.
    execute format('drop policy if exists %s_write on public.%I', t, t);
    execute format(
      'create policy %s_write on public.%I for all to authenticated using (exists ('
      'select 1 from public.app_users u where u.id = auth.uid() '
      'and u.role in (''skipper'',''officer'',''engineer''))) with check (exists ('
      'select 1 from public.app_users u where u.id = auth.uid() '
      'and u.role in (''skipper'',''officer'',''engineer'')))', t, t);

    -- Audited, like the other books this app keeps by hand.
    execute format('drop trigger if exists audit_%s on public.%I', t, t);
    execute format(
      'create trigger audit_%s after insert or update or delete on public.%I '
      'for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;
