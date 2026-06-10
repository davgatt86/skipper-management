-- ============================================================
-- Allow the Danish daily price emails through the ingest webhook.
--
-- Hanstholm Fiskeauktion mails the price sheet straight to the
-- CloudMailin address (not forwarded from your Gmail), so the
-- ingest function saw only the auction's own addresses and bounced
-- with "unknown forwarder". The two machine addresses it listed
-- (…@em934663.hanstholmfiskeauktion.dk and …@hfa.local) carry a
-- random token that changes every send, so we whitelist the whole
-- auction DOMAIN instead of a single address — covered by the
-- domain-rule matching added to netlify/functions/ingest.js.
--
-- cloudmailin.net and smtp2go.com are deliberately NOT added: those
-- are mail infrastructure every message passes through, so allowing
-- them would let anything in.
--
-- Run once in the Supabase SQL editor. Idempotent. Maps to the
-- AUDACIOUS BF83 fleet (price sheets feed the shared board, so the
-- fleet only matters for routing any Hanstholm sales notes).
-- ============================================================

with target as (
  select id
  from public.fleets
  order by (name = 'AUDACIOUS BF83') desc, created_at asc
  limit 1
)
insert into public.ingest_senders (email, fleet_id, label)
select v.email, t.id, v.label
from target t
cross join (values
  ('@hanstholmfiskeauktion.dk', 'Hanstholm Fiskeauktion — Danish daily prices')
) as v(email, label)
where not exists (
  select 1 from public.ingest_senders s
  where lower(s.email) = lower(v.email)
);

-- Show what's now allowed
select email, label, fleet_id from public.ingest_senders order by email;
