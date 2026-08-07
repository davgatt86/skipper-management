-- ============================================================
-- Vessel certificates — the vessel's own papers, as distinct from
-- the crew's. Applied and verified Aug 2026.
--
-- Same column shape as crew_certificates on purpose, so certStatus /
-- certUrgency and the same 60-day lead work unchanged and "expired"
-- means the same thing on both pages.
-- ============================================================

create table if not exists public.vessel_certificates (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null default current_fleet_id() references public.fleets(id) on delete cascade,
  cert_type   text not null,
  category    text,
  cert_number text,
  issuer      text,
  issue_date  date,
  expiry_date date,
  file_path   text,
  file_name   text,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists vessel_certificates_fleet_idx  on public.vessel_certificates (fleet_id);
create index if not exists vessel_certificates_expiry_idx on public.vessel_certificates (expiry_date);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.vessel_certificates to authenticated;

alter table public.vessel_certificates enable row level security;

create policy fleet_isolation_vessel_certificates on public.vessel_certificates
  as restrictive for all
  using (fleet_id = current_fleet_id())
  with check (fleet_id = current_fleet_id());

create policy vessel_certificates_read on public.vessel_certificates for select
  using (exists (select 1 from app_users u
                  where u.id = auth.uid()
                    and u.role = any (array['skipper'::user_role,'viewer'::user_role])));

create policy vessel_certificates_write_ins on public.vessel_certificates for insert
  with check (exists (select 1 from app_users u
                       where u.id = auth.uid() and u.role = 'skipper'::user_role));

create policy vessel_certificates_write_upd on public.vessel_certificates for update
  using (exists (select 1 from app_users u
                  where u.id = auth.uid() and u.role = 'skipper'::user_role))
  with check (exists (select 1 from app_users u
                       where u.id = auth.uid() and u.role = 'skipper'::user_role));

create policy vessel_certificates_write_del on public.vessel_certificates for delete
  using (exists (select 1 from app_users u
                  where u.id = auth.uid() and u.role = 'skipper'::user_role));


-- ---- The 15 Audacious holds in Aegir, read 07-08-2026 ----------------
-- Categories are Aegir's own (Statutory / Insurance / Safety), kept as held
-- rather than re-sorted, so the two records can be compared. Two oddities in
-- their data are recorded in notes rather than silently corrected.
insert into public.vessel_certificates
  (fleet_id, cert_type, category, cert_number, issuer, issue_date, expiry_date, file_name, notes)
select f.id, v.cert_type, v.category, nullif(v.cert_number,''), v.issuer,
       v.issue_date, v.expiry_date, nullif(v.file_name,''), nullif(v.notes,'')
  from public.fleets f
  cross join (values
    ('TBT-Free Antifouling', 'Statutory', 'BF326', 'PPG Protective & Marine Coatings', date '2017-07-20', null::date, 'image.jpg', ''),
    ('Certificate of Insurance', 'Insurance', '2025/SM/UK/M002470', 'NorthStandard Limited Trading as Sunderland Marine', date '2025-04-01', date '2026-03-31', 'image.jpg', 'Left expired on purpose as test data for the expiry notices.'),
    ('Certificate of Insurance or other financial security in respect of liability for the removal of wrecks', 'Insurance', 'ip06Kg9M', 'Maritime and Coastguard Agency', date '2025-05-12', date '2026-03-31', 'image.jpg', ''),
    ('Gaseous Fire Suppression System Commissioning/Maintenance Certificate', 'Safety', '3134', 'Marine Fire Safety', date '2024-08-20', date '2026-07-20', 'image.jpg', ''),
    ('INFLATABLE LIFERAFT SERVICE CERTIFICATE', 'Safety', '25771155', 'Marasafe Ltd', date '2025-07-24', date '2026-07-24', 'image.jpg', ''),
    ('Liferaft Inspection & Service Schedule / Certification', 'Safety', 'JJ5315', 'SEAGO', date '2025-07-24', date '2026-07-31', 'image.jpg', ''),
    ('Portable Fire Extinguisher Commissioning/Maintenance Certificate', 'Safety', '7573', 'MARASAFE', date '2025-08-26', date '2026-08-26', 'image.jpg', ''),
    ('SERVICE CERTIFICATE - LIFEJACKET', 'Safety', '', 'Marasafe Ltd', date '2026-03-17', date '2027-03-17', 'image.jpg', ''),
    ('SHIPS MEDICAL STORES CERTIFICATE', 'Safety', '', 'Dickies Pharmacy (KDP (ABERDEEN) Ltd)', date '2026-03-17', date '2027-03-17', 'image.jpg', ''),
    ('Record of Particulars of a Fishing Vessel', 'Statutory', 'CM64288', 'Maritime & Coastguard Agency', date '2023-10-13', date '2027-05-19', 'image.jpg', ''),
    ('UK Fishing Vessel Cert', 'Statutory', '', 'MCA', date '2022-07-19', date '2027-07-19', 'UKFVC.pdf', ''),
    ('ILO Work in Fishing Convention (ILO 188) Document of Compliance', 'Statutory', '162ec006-c625-404d-b12e-263704ad1ef2', 'Maritime & Coastguard Agency', date '2022-09-02', date '2027-07-20', 'image.jpg', 'Certificate number in Aegir is a UUID — looks like a system id entered by mistake. Check against the paper certificate.'),
    ('United Kingdom Certificate of Registry', 'Statutory', '', 'Maritime & Coastguard Agency', date '2022-09-13', date '2027-08-01', 'IMG_2659.jpeg', ''),
    ('Certificate of Measurement', 'Safety', '170941/BEL/2301A/1600001', 'Maritime & Coastguard Agency', date '2017-06-26', date '2030-03-05', 'image.jpg', 'Aegir files this under Safety; it is really a Statutory certificate.'),
    ('Builder''s Certificate', 'Statutory', 'MSF 4743', 'Maritime and Coastguard Agency', date '2017-06-23', date '2030-03-05', 'image.jpg', '')
  ) as v(cert_type, category, cert_number, issuer, issue_date, expiry_date, file_name, notes)
 where f.name = 'AUDACIOUS BF83'
   and not exists (select 1 from public.vessel_certificates x
                    where x.fleet_id = f.id and x.cert_type = v.cert_type);


-- ============================================================
-- FILES ARE NOT CARRIED OVER
--   file_name records what Aegir holds against each certificate, but the
--   image itself is still only in Aegir. Storing the original photo/PDF is
--   on the action list and needs a bucket with the same fleet isolation.
--   Until then file_path stays null and the name is a pointer, not a link.
-- ============================================================


-- ============================================================
-- VERIFY
-- ============================================================
select category, count(*) as n,
       count(*) filter (where expiry_date < current_date) as expired,
       count(*) filter (where expiry_date is null) as no_expiry
  from public.vessel_certificates group by category order by category;
-- expect Insurance 2 (2 expired), Safety 7 (3 expired), Statutory 6 (1 no expiry)

select cert_type, expiry_date, current_date - expiry_date as days_overdue
  from public.vessel_certificates
 where expiry_date < current_date order by expiry_date;


-- ============================================================
-- WHAT THIS SURFACED — worth acting on, not a code issue
--   Five certificates are expired. Only ONE of them is the test data
--   CLAUDE.md records (Certificate of Insurance, 31-03-2026). The wreck
--   removal cover shares that date so is probably the same renewal.
--
--   The other three look like genuine lapses on safety equipment:
--     Gaseous Fire Suppression System   expired 20-07-2026
--     Inflatable Liferaft Service       expired 24-07-2026
--     Liferaft Inspection & Service     expired 31-07-2026
--   and the Portable Fire Extinguisher certificate expires 26-08-2026.
--
--   Which is the argument for this page existing: they sat in Aegir where
--   nothing chased them.
-- ============================================================
