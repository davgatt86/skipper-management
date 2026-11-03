-- uk_quota_holders.sql — the UK quota holders page (/quota-holders), Nov 2026.
--
-- WHAT IT HOLDS. An export of the public FQA register
-- (fqaregister.service.gov.uk): every licence holding Fixed Quota Allocation
-- units — the holder, the vessel or PO "dummy" licence, the PO, and the units
-- per stock. Like the swaps page it is NOT any fleet's own data: one shared
-- copy, read by every non-demo fleet's skippers and viewers. David, Nov 2026:
-- show every name, exactly as the public register does.
--
-- WHY A TABLE OF ITS OWN and not more rows in quota_swaps_data: the weekly swaps
-- load ends with quota_swaps_prune(), which deletes every (dataset, year) that
-- build did not produce. The register is loaded by hand when a new export is
-- taken, not weekly, so in that table it would be wiped every Thursday.
--
-- WHO WRITES IT: nobody through the API. quota_holders_load() checks the SAME
-- loader token as the swaps (its sha256 in quota_swaps_loader), so there is one
-- secret, kept in the Claude task and never in this repo, which is public.
--
-- TONNES ARE NOT STORED. The page works them out from units and each year's PO
-- TAC shares in quota_swaps_data (dataset 'balances'), so they move on by
-- themselves when a new year's TACs reach the uptake report.

create table if not exists public.quota_holders_data (
  dataset     text        not null primary key,   -- fqa_holdings, fqa_species, fqa_meta
  payload     jsonb       not null,
  n_rows      int         not null default 0,
  updated_at  timestamptz not null default now()
);

comment on table public.quota_holders_data is
  'UK quota holders page. Shared, cross-fleet, read-only: the public FQA register. Written only by quota_holders_load().';

alter table public.quota_holders_data enable row level security;

grant usage on schema public to authenticated;
grant select on public.quota_holders_data to authenticated;
revoke insert, update, delete on public.quota_holders_data from anon, authenticated;

drop policy if exists quota_holders_read on public.quota_holders_data;
create policy quota_holders_read on public.quota_holders_data
  for select to authenticated
  using (exists (
    select 1 from public.app_users u
    join public.fleets f on f.id = u.fleet_id
    where u.id = auth.uid()
      and u.role::text in ('skipper', 'viewer')
      and not coalesce(f.is_demo, false)
  ));

create or replace function public.quota_holders_load(p_token text, p_dataset text, p_payload jsonb)
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  if not exists (select 1 from quota_swaps_loader
                 where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) then
    raise exception 'quota_holders_load: not authorised' using errcode = '42501';
  end if;
  if p_dataset !~ '^[a-z_]{2,40}$' then
    raise exception 'quota_holders_load: bad dataset name';
  end if;
  if jsonb_typeof(p_payload) <> 'array' then
    raise exception 'quota_holders_load: payload must be a JSON array of rows';
  end if;
  n := jsonb_array_length(p_payload);
  insert into quota_holders_data (dataset, payload, n_rows, updated_at)
  values (p_dataset, p_payload, n, now())
  on conflict (dataset) do update
    set payload = excluded.payload, n_rows = excluded.n_rows, updated_at = now();
  return n;
end $$;

revoke all on function public.quota_holders_load(text, text, jsonb) from public;
grant execute on function public.quota_holders_load(text, text, jsonb) to anon, authenticated;
