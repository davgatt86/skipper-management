-- Which page of a scanned BUNDLE a vessel certificate is on.
--
-- David, Sep 2026, on `L.S.A Certs.pdf`: "is it possible to read that like we
-- do with the invoices and direct the user to the page number of the cert?"
--
-- A bundle is one file holding several certificates, one after another. Until
-- now a certificate row held one file and that file WAS the certificate; with a
-- bundle several rows point at one file and each has to say which page is its
-- own. Same idea as su_invoices.page_from / page_to.
--
-- A PAGE MEANS NOTHING WITHOUT ITS FILE, so the constraint says so. JS
-- validation is not a constraint — the ORB item list proved that when a probe
-- wrote C/99.9 straight into the book — and a page number left behind on a row
-- whose file is later swapped for a single scan would open that scan at a page
-- it does not have, looking certain doing it.
--
-- BOTH OR NEITHER, AND IN ORDER. A one-page certificate carries the same page
-- twice; "from 3 to nothing" is not a range anybody can open.
alter table public.vessel_certificates
  add column if not exists page_from int,
  add column if not exists page_to int;

alter table public.vessel_certificates drop constraint if exists vessel_cert_pages_sane;
alter table public.vessel_certificates add constraint vessel_cert_pages_sane check (
  (page_from is null and page_to is null)
  or (page_from >= 1 and page_to >= page_from and file_path is not null)
);

comment on column public.vessel_certificates.page_from is
  'First page of this certificate within file_path, where that file is a scanned '
  'bundle of several certificates. Null means the file is this certificate alone, '
  'or the page was not known — never a guess.';
comment on column public.vessel_certificates.page_to is
  'Last page of this certificate within file_path. Equal to page_from for a '
  'one-page certificate.';
