-- The `cook` role — stores and provisions, and nothing else at all.
--
-- Stage 2 of the stores build. The cook keeps the provisions list as the trip
-- goes on, so he needs a login; he has no business in the money, the sales,
-- the crew records or the logs.
--
-- SAME ALLOW-LIST MACHINERY AS `officer_role.sql`. RE-RUN BOTH FILES AFTER
-- ADDING ANY TABLE. They are idempotent and independent — a table added next
-- year is denied to both roles by default, and somebody has to think in order
-- to open it up. A hand-written deny-list would silently leak every new table,
-- which is the exact bug this shape exists to prevent.
--
-- WHY A NEW ROLE IS THE DANGEROUS PART
--
-- Every permissive policy in this database is `to authenticated using (true)`
-- with only the restrictive fleet check beside it. So a brand-new role sees
-- EVERYTHING IN ITS FLEET the moment it exists — it is denied by nothing until
-- this file runs. Adding the enum value without this file is the whole leak.
--
-- And the loop in section 2 only touches tables OUTSIDE the allow-list, so it
-- cannot clear a denial from a table that has just JOINED one. That is the
-- order-of-operations that shut officers out of crew certs once already, and
-- section 2b is the cleanup for it.
--
-- PERFORMANCE: EVERY CALL IS WRAPPED IN A SCALAR SUBSELECT, AND MUST BE.
-- `not is_cook()` written bare is evaluated once per ROW; on market_prices
-- (44k rows) that was 4.2 seconds against 8 ms wrapped. See officer_role.sql.

-- 1. -------------------------------------------------------------------------
-- The enum value must already have been added, IN ITS OWN TRANSACTION:
--   alter type public.user_role add value if not exists 'cook';
-- Postgres will not let a new enum value be used in the same transaction that
-- created it, so it cannot live in this file.

create or replace function public.is_cook()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(public.current_user_role() = 'cook', false)
$$;

comment on function public.is_cook() is
  'True for a cook login. Used as `not is_cook()` in restrictive policies so a '
  'null role reads as "not a cook" and no existing role is affected.';

grant execute on function public.is_cook() to authenticated;


-- 2. Deny everything outside the allow-list ---------------------------------
do $$
declare
  t text;
  allowed text[] := array[
    -- writes: the provisions list, and the fleet's own catalogue corrections.
    -- stores_items is writable because fixing a unit or adding an item the
    -- shop carries is the cook's job — that is the point of the role.
    'stores_items', 'stores_lists', 'stores_list_items',
    -- reads only: the rows the app shell needs to boot and know who he is.
    'fleets', 'settings', 'app_users'
  ];
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not (c.relname = any(allowed))
  loop
    execute format('drop policy if exists cook_no_access on public.%I', t);
    execute format(
      'create policy cook_no_access on public.%I as restrictive for all '
      'to authenticated using (not (select public.is_cook())) '
      'with check (not (select public.is_cook()))', t);
  end loop;
end $$;

-- 2b. Clear the denial from anything that has just JOINED the list ----------
-- The loop above cannot do this, because it only visits tables outside the
-- list. Without this, a table promoted into the allow-list keeps the
-- `cook_no_access` policy it was given while it was outside, and the cook is
-- shut out of it with everything else looking correct.
do $$
declare
  t text;
  allowed text[] := array[
    'stores_items','stores_lists','stores_list_items',
    'fleets','settings','app_users'
  ];
begin
  foreach t in array allowed loop
    execute format('drop policy if exists cook_no_access on public.%I', t);
  end loop;
end $$;


-- 3. Read-only on the shell tables -----------------------------------------
-- He may read them to boot the app and must not change any of them. Written as
-- three restrictive policies rather than one, because a restrictive policy
-- applies per command.
do $$
declare t text;
begin
  foreach t in array array['fleets','settings','app_users'] loop
    execute format('drop policy if exists cook_read_only_ins on public.%I', t);
    execute format('drop policy if exists cook_read_only_upd on public.%I', t);
    execute format('drop policy if exists cook_read_only_del on public.%I', t);
    execute format(
      'create policy cook_read_only_ins on public.%I as restrictive for insert '
      'to authenticated with check (not (select public.is_cook()))', t);
    execute format(
      'create policy cook_read_only_upd on public.%I as restrictive for update '
      'to authenticated using (not (select public.is_cook()))', t);
    execute format(
      'create policy cook_read_only_del on public.%I as restrictive for delete '
      'to authenticated using (not (select public.is_cook()))', t);
  end loop;
end $$;


-- 4. Let the cook actually write the stores tables --------------------------
-- stores.sql shipped `stores_write` as skipper-only, since the role did not
-- exist yet. Widen it. The restrictive fleet_isolation and cook_no_access
-- policies still stand beside it, so this opens the stores tables and nothing
-- else.
do $$
declare t text;
begin
  foreach t in array array['stores_items','stores_lists','stores_list_items'] loop
    execute format('drop policy if exists stores_write on public.%I', t);
    execute format(
      'create policy stores_write on public.%I for all to authenticated
         using (exists (select 1 from public.app_users u
                         where u.id = (select auth.uid())
                           and u.role in (''skipper'', ''cook'')))
         with check (exists (select 1 from public.app_users u
                              where u.id = (select auth.uid())
                                and u.role in (''skipper'', ''cook'')))', t);
  end loop;
end $$;


-- 5. Storage is shut ---------------------------------------------------------
-- A stores list carries no files. Denying the whole bucket layer is one policy
-- rather than a judgement per bucket, and is the safe direction to fail in.
drop policy if exists cook_no_storage on storage.objects;
create policy cook_no_storage on storage.objects as restrictive for all
  to authenticated
  using (not (select public.is_cook()))
  with check (not (select public.is_cook()));


-- 6. Notes -------------------------------------------------------------------
--
-- `crew_aboard_count()` is SECURITY DEFINER and stays that way. It is how the
-- cook gets "meals for 11" without being granted the crew table — the number
-- he needs for the butcher's order, and nothing else about the men aboard.
--
-- `check_crew_id_role` on app_users allows a `crew_id` ONLY for role 'crew'
-- and REQUIRES one there. So a cook login must NOT be linked to a crew record,
-- even though the man himself is on the crew list. manage-users.js validates
-- this in words before the insert.
--
-- `crew_ranks` has RLS disabled entirely, so no policy here can cover it. It
-- is a global lookup of rank codes readable by anyone signed in. Deliberate,
-- and unchanged.
--
-- Verify by PROBE, not by inspection. An UPDATE matching zero rows succeeds
-- silently, so assert on ROW_COUNT and never on "did it throw".
