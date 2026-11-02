-- uk_quota_swaps.sql — the UK quota swaps page (/quota-swaps), Nov 2026.
--
-- WHAT IT HOLDS. The Marine Directorate's weekly quota uptake report, which the
-- SWFPA forwards every week, worked into who swapped what with whom: every PO's
-- weekly swaps by stock, the inferred PO-to-PO deals, each PO's balance, UK
-- international swaps, flex, and landings for stocks with no PO allocation.
--
-- IT IS NOT ANY FLEET'S OWN DATA. It is the same industry-wide report every PO
-- member receives, so it is ONE shared copy, read by every fleet — the second
-- deliberately cross-fleet page after Price vs Fleet, and unlike that one it
-- carries nothing a fleet entered. David, Nov 2026: every fleet on the app sees it.
--
-- WHO READS IT: a skipper or viewer of a NON-DEMO fleet. Not the demo login
-- (it goes to strangers), and not officer/cook (their allow-lists are menus of
-- their own pages; this is not one of them). Re-running engineer_role.sql /
-- officer_role.sql / cook_role.sql after this adds their usual restrictive deny,
-- which changes nothing because the select policy below already excludes them.
--
-- WHO WRITES IT: nobody through the API. The weekly load comes from the Claude
-- scheduled task that reads Lianne's email, through quota_swaps_load(), which
-- checks a token whose sha256 alone is stored here. The token itself is kept
-- only in that task's prompt — never in this repo, which is public.
--
-- SHAPE. One row per (dataset, year) holding that year's rows as JSON. The page
-- asks for one year at a time, so it moves ~1-2 MB, not the whole history, and
-- a weekly reload replaces a year in one statement rather than diffing rows.

create table if not exists public.quota_swaps_data (
  dataset     text        not null,
  year        int         not null,          -- 0 = not year-specific (lists, headline)
  payload     jsonb       not null,
  n_rows      int         not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (dataset, year)
);

comment on table public.quota_swaps_data is
  'UK quota swaps page. Shared, cross-fleet, read-only: the Marine Directorate uptake report worked into weekly swaps. Written only by quota_swaps_load().';

alter table public.quota_swaps_data enable row level security;

grant usage on schema public to authenticated;
grant select on public.quota_swaps_data to authenticated;
revoke insert, update, delete on public.quota_swaps_data from anon, authenticated;

drop policy if exists quota_swaps_read on public.quota_swaps_data;
create policy quota_swaps_read on public.quota_swaps_data
  for select to authenticated
  using (exists (
    select 1 from public.app_users u
    join public.fleets f on f.id = u.fleet_id
    where u.id = auth.uid()
      and u.role::text in ('skipper', 'viewer')
      and not coalesce(f.is_demo, false)
  ));

-- The loader's key. Only the hash is stored; no policy, so nothing reads it
-- through the API — the SECURITY DEFINER function below is the only reader.
create table if not exists public.quota_swaps_loader (
  id          int primary key default 1 check (id = 1),
  token_hash  text not null,
  created_at  timestamptz not null default now()
);
alter table public.quota_swaps_loader enable row level security;
revoke all on public.quota_swaps_loader from anon, authenticated;

create or replace function public.quota_swaps_load(p_token text, p_dataset text, p_year int, p_payload jsonb)
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  ok boolean;
  n int;
begin
  select exists (select 1 from quota_swaps_loader
                 where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'))
    into ok;
  if not ok then
    raise exception 'quota_swaps_load: not authorised' using errcode = '42501';
  end if;
  if p_dataset !~ '^[a-z_]{2,40}$' then
    raise exception 'quota_swaps_load: bad dataset name';
  end if;
  if jsonb_typeof(p_payload) <> 'array' then
    raise exception 'quota_swaps_load: payload must be a JSON array of rows';
  end if;
  n := jsonb_array_length(p_payload);
  insert into quota_swaps_data (dataset, year, payload, n_rows, updated_at)
  values (p_dataset, p_year, p_payload, n, now())
  on conflict (dataset, year) do update
    set payload = excluded.payload, n_rows = excluded.n_rows, updated_at = now();
  return n;
end $$;

-- Remove a (dataset, year) the weekly build no longer produces, e.g. a run-out
-- table for a year that has ended.
create or replace function public.quota_swaps_prune(p_token text, p_keep text[])
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if not exists (select 1 from quota_swaps_loader
                 where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) then
    raise exception 'quota_swaps_prune: not authorised' using errcode = '42501';
  end if;
  delete from quota_swaps_data where not ((dataset || ':' || year) = any (p_keep));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.quota_swaps_load(text, text, int, jsonb) from public;
revoke all on function public.quota_swaps_prune(text, text[]) from public;
grant execute on function public.quota_swaps_load(text, text, int, jsonb) to anon, authenticated;
grant execute on function public.quota_swaps_prune(text, text[]) to anon, authenticated;
