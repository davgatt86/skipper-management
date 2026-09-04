-- WHEN THE BUNDLE ACTUALLY ARRIVED  (applied Sep 2026)
--
-- All 364 historical bundles were carrying `received_at` of 1-2 September 2026,
-- because that is when they were UPLOADED. `received_at` defaults to now(), and
-- the ten-year backlog went in over two days — so the Arrivals tab listed a
-- decade of Monday emails as though they had all landed in one weekend, and
-- ordering by arrival told you nothing at all.
--
-- IT WAS RECOVERABLE, and only because of how the extraction happened to name
-- the files: `scripts/gmail-attachments.gs` prefixed each attachment with its
-- EMAIL's date — "2017-02-27 SKM_C3350170227132800.pdf". The scanner clock in
-- the body of the name is the scan time, which is close but is not the same
-- fact; the prefix is the email, which is what `received_at` means.
--
--   363 of 364 recovered, 2017-02-27 to 2026-08-31, 331 distinct arrival dates
--
-- THE ONE THAT CANNOT BE IS LEFT ALONE. It has no date prefix, so it keeps the
-- upload date and is honestly wrong rather than dishonestly plausible — the
-- same rule as an invoice with no date getting its own column instead of being
-- guessed into the current year.
update public.su_invoice_batches
   set received_at = (substring(filename from '^\d{4}-\d{2}-\d{2}'))::date + time '09:00',
       note = coalesce(note || ' · ', '') || 'arrival date recovered from the email, Sep 2026'
 where filename ~ '^\d{4}-\d{2}-\d{2} ';
