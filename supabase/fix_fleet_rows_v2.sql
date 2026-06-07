-- ============================================================
-- FLEET FIX v2 (safe) — run once
-- The "ghost" fleet row holds stale invisible duplicates of old
-- data (e.g. sales notes), so deleting/moving it blind is risky.
-- Instead: rename it to an archive label nobody can confuse,
-- rename your real fleet to AUDACIOUS BF83, create BERYL's
-- missing settings row, then PRINT an inventory of what the
-- archive actually holds so we can purge it deliberately later.
-- ============================================================
do $$
declare
  v_don   uuid;
  v_ghost uuid := '00000000-0000-4000-8000-000000000001';
  v_beryl uuid;
  v_cols  text;
begin
  select id into v_don from public.fleets where name = 'The Don Fishing Co. Ltd';
  select id into v_beryl from public.fleets where name = 'BERYL BF440';
  if v_don is null then
    raise exception 'No fleet named The Don Fishing Co. Ltd — already renamed? Check: select id, name from fleets;';
  end if;

  -- 1. archive label on the ghost, boat name on the real fleet
  update public.fleets set name = 'ZZ ARCHIVE — old data, ignore' where id = v_ghost;
  update public.fleets set name = 'AUDACIOUS BF83' where id = v_don;

  -- 2. BERYL settings, copied from your real fleet (was missed because
  --    the earlier copy read from the ghost)
  if v_beryl is not null
     and not exists (select 1 from public.settings where fleet_id = v_beryl) then
    select string_agg(quote_ident(column_name), ', ')
    into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'settings'
      and column_name not in ('id', 'fleet_id', 'created_at', 'updated_at');
    execute format(
      'insert into public.settings (fleet_id, %s)
       select %L, %s from public.settings where fleet_id = %L limit 1',
      v_cols, v_beryl, v_cols, v_don);
    raise notice 'settings row created for BERYL BF440';
  end if;
end $$;

-- 3. Fleets check: AUDACIOUS BF83 + BERYL BF440 with settings,
--    archive with none of either
select f.name,
       count(distinct u.id) as users,
       count(distinct s.fleet_id) as settings_rows
from public.fleets f
left join public.app_users u on u.fleet_id = f.id
left join public.settings  s on s.fleet_id = f.id
group by f.name
order by f.name;

-- 4. Inventory: how many rows the archive fleet holds, per table
--    (send me this output — it decides the purge plan)
do $$
declare
  t record; n bigint;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'fleet_id'
      and table_name <> 'fleets'
    order by table_name
  loop
    execute format('select count(*) from public.%I where fleet_id = %L',
                   t.table_name, '00000000-0000-4000-8000-000000000001')
    into n;
    if n > 0 then
      raise notice 'archive fleet holds % row(s) in %', n, t.table_name;
    end if;
  end loop;
end $$;
