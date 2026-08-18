-- Let a skipper put a failed reconciliation to bed.
--
-- `reconcile_ok = false` means the parsed rows did not add up to the total
-- printed on the note. Usually that is worth fixing — the wrapped-row bug
-- (parser 1.3.3) silently dropped A+ rows and cost real money — and the fix is
-- for the skipper to upload the note again.
--
-- But some can never be fixed. The ten P&J Johnstone landings on Guiding Light
-- and Faithlie have blank buyers because they were parsed before the
-- coordinate fix, and P&J will not supply the notes again. A banner that nags
-- about ten things nobody can do anything about is the same failure as the
-- 29-alerts-a-day price stream: it teaches the reader to ignore the banner,
-- including on the day it matters.
--
-- So the banner is driven by the data and clears itself when a note is
-- re-uploaded, and anything genuinely unfixable can be acknowledged once.

alter table public.sales_landings
  add column if not exists reconcile_ack_at   timestamptz,
  add column if not exists reconcile_ack_by   uuid references auth.users(id),
  add column if not exists reconcile_ack_note text;

comment on column public.sales_landings.reconcile_ack_at is
  'Set when a skipper has accepted that this note cannot be re-uploaded. Hides '
  'it from the re-upload banner; does NOT change reconcile_ok, which stays as '
  'the record that the figures are not trustworthy.';

-- The ten P&J landings, acknowledged: David confirmed Aug 2026 that P&J will
-- not supply these notes again, so nobody can act on them. Recorded rather
-- than filtered in code, so the reason travels with the row.
update public.sales_landings
   set reconcile_ack_at = now(),
       reconcile_ack_note = 'Blank buyers — parsed before the P&J coordinate fix, '
                            'and P&J will not supply the note again. '
                            'Species, weight and value are sound; only the buyer is missing.'
 where reconcile_ok = false
   and market like 'P&J%'
   and reconcile_ack_at is null;
