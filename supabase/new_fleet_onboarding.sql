-- ============================================================
-- NEW BOAT ONBOARDING — one run per new skipper/vessel
--
-- BEFORE running this:
--   1. Supabase dashboard -> Authentication -> Users -> Add user
--      - their real email + a temp password
--      - tick "Auto Confirm User"
--      (they change the password themselves in the app:
--       Dashboard -> Change password)
--
-- THEN edit the three values below and run the whole script.
-- ============================================================

do $$
declare
  v_vessel  text := 'BOY ANDREW WK170';        -- <-- vessel name = fleet name
  v_email   text := 'skipper@example.com';     -- <-- their auth email (exact)
  v_name    text := 'Skipper Name';            -- <-- display name in the app
  v_fleet   uuid := gen_random_uuid();
  v_user    uuid;
  v_cols    text;
begin
  -- their auth user must exist first
  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    raise exception 'No auth user with email % — create them in Authentication -> Users first', v_email;
  end if;
  if exists (select 1 from public.app_users where id = v_user or email = v_email) then
    raise exception 'User % already has an app_users row', v_email;
  end if;

  -- 1. fleet
  insert into public.fleets (id, name) values (v_fleet, v_vessel);

  -- 2. skipper app user in that fleet — built dynamically against the
  --    real app_users columns (fills id, email, name, role, fleet_id and
  --    any aliases; tells you plainly if a required column is unknown)
  declare
    r record;
    cols text := '';
    vals text := '';
  begin
    for r in
      select column_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'app_users'
      order by ordinal_position
    loop
      if r.column_name in ('id', 'user_id', 'auth_id', 'auth_user_id') then
        cols := cols || quote_ident(r.column_name) || ', ';
        vals := vals || quote_literal(v_user) || '::uuid, ';
      elsif r.column_name = 'email' then
        cols := cols || 'email, ';
        vals := vals || quote_literal(v_email) || ', ';
      elsif r.column_name in ('display_name', 'full_name', 'name') then
        cols := cols || quote_ident(r.column_name) || ', ';
        vals := vals || quote_literal(v_name) || ', ';
      elsif r.column_name = 'role' then
        cols := cols || 'role, ';
        vals := vals || quote_literal('skipper') || ', ';
      elsif r.column_name = 'fleet_id' then
        cols := cols || 'fleet_id, ';
        vals := vals || quote_literal(v_fleet) || '::uuid, ';
      elsif r.is_nullable = 'NO' and r.column_default is null then
        raise exception 'app_users has a required column I don''t know how to fill: % — send this name back', r.column_name;
      end if;
    end loop;
    cols := left(cols, -2);
    vals := left(vals, -2);
    raise notice 'app_users insert: (%) = (%)', cols, vals;
    execute format('insert into public.app_users (%s) values (%s)', cols, vals);
  end;

  -- 3. settings row, copied from YOUR fleet's settings as a starting
  --    point (they can ask for different rates later)
  select string_agg(quote_ident(column_name), ', ')
  into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'settings'
    and column_name not in ('id', 'fleet_id', 'created_at', 'updated_at');

  execute format(
    'insert into public.settings (fleet_id, %s)
     select %L, %s from public.settings s
     join public.fleets f on f.id = s.fleet_id
     where f.name = %L limit 1',
    v_cols, v_fleet, v_cols, 'AUDACIOUS BF83');

  raise notice 'Fleet % created: % / skipper %', v_fleet, v_vessel, v_email;
end $$;

-- Verify: every fleet with its members
select f.name as fleet, u.display_name, u.role
from public.fleets f
left join public.app_users u on u.fleet_id = f.id
order by f.name, u.role;
