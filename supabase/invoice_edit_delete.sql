-- EDITING AND DELETING AN INVOICE, and the trail that makes it safe.
-- Applied Sep 2026 as migration `su_invoice_changes_and_delete`.
--
-- David, Sep 2026: "add a delete part where invoices can be edited."
--
-- EVERY DELETE SO FAR HAS BEEN DONE BY HAND AND WRITTEN UP BY HAND. The reason
-- lived in `su_invoice_batches.note` because `su_*` carries no audit trail by
-- design: it is written by an edge function on the service-role key, where
-- `auth.uid()` is null, so the ordinary `audit_trigger()` would record that
-- nobody did it. That was survivable while a delete was a deliberate act by one
-- person with a SQL console. A button changes it completely: £147,985.99 went
-- out on one of those hand deletes, and a button that can do the same thing and
-- leave no trace is not a feature, it is a hole.
--
-- So the trail is not a trigger, it is part of the act. `su_delete_invoice`
-- snapshots the row and removes it IN ONE STATEMENT, and there is no path in
-- the app that deletes an invoice any other way.

create table if not exists public.su_invoice_changes (
  id          uuid primary key default gen_random_uuid(),
  fleet_id    uuid not null references public.fleets(id) on delete cascade,
  -- NOT a foreign key, deliberately. The whole point of a delete record is that
  -- it outlives the invoice; a reference would either block the delete or be
  -- cascaded away with it, and either way the record would be worthless.
  invoice_id  uuid not null,
  action      text not null check (action in ('edit', 'delete')),
  -- The WHOLE row as it stood. Not a diff: a diff is only readable against a
  -- row that still exists, which after a delete it does not.
  before      jsonb not null,
  after       jsonb,
  reason      text,
  changed_by  uuid references public.app_users(id),
  changed_at  timestamptz not null default now()
);

create index if not exists su_invoice_changes_idx
  on public.su_invoice_changes (fleet_id, changed_at desc);

alter table public.su_invoice_changes enable row level security;

drop policy if exists su_invoice_changes_read on public.su_invoice_changes;
create policy su_invoice_changes_read on public.su_invoice_changes
  for select to authenticated using (
    fleet_id = current_fleet_id()
    and exists (select 1 from public.app_users u
                where u.id = auth.uid() and u.role in ('skipper','viewer')));

-- Written only by the two functions below, both SECURITY DEFINER. Nothing
-- inserts into it directly, so there is no way to write a false entry, and
-- Supabase's default grant of `arwdDxtm` to `authenticated` is revoked so an
-- absent policy is not the only thing standing in the way.
revoke all on public.su_invoice_changes from authenticated, anon;
grant select on public.su_invoice_changes to authenticated;


-- DELETE ONE INVOICE, and record it in the same breath ---------------------
create or replace function public.su_delete_invoice(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid := current_fleet_id();
  row_before jsonb;
begin
  if f is null then raise exception 'no fleet in scope'; end if;
  if not exists (select 1 from public.app_users u
                 where u.id = auth.uid() and u.role = 'skipper') then
    raise exception 'only the skipper may delete an invoice';
  end if;

  /* SCOPED ON FLEET AS WELL AS ID. SECURITY DEFINER bypasses RLS, so the
     boundary has to be written here -- and this app holds an agent grant over
     another business's boat, which is a READ and must never decide what gets
     written or removed. */
  select to_jsonb(i) into row_before
  from public.su_invoices i where i.id = p_id and i.fleet_id = f;
  if row_before is null then raise exception 'no such invoice in this fleet'; end if;

  insert into public.su_invoice_changes (fleet_id, invoice_id, action, before, reason, changed_by)
  values (f, p_id, 'delete', row_before, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());

  delete from public.su_invoices where id = p_id and fleet_id = f;
  return row_before;
end $$;


-- EDIT THE FIGURES ON ONE INVOICE ------------------------------------------
-- Only the fields a person can read off the scan and correct. The boat, the
-- category and the work dates keep their own setters -- those are ANSWERS to
-- questions the invoice cannot answer, and they are not corrections.
create or replace function public.su_edit_invoice(p_id uuid, p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid := current_fleet_id();
  row_before jsonb;
  row_after  jsonb;
  allowed text[] := array['supplier','invoice_no','invoice_date','net','vat','total',
                          'currency','description','page_from','page_to'];
  k text;
begin
  if f is null then raise exception 'no fleet in scope'; end if;
  if not exists (select 1 from public.app_users u
                 where u.id = auth.uid() and u.role = 'skipper') then
    raise exception 'only the skipper may edit an invoice';
  end if;

  select to_jsonb(i) into row_before
  from public.su_invoices i where i.id = p_id and i.fleet_id = f;
  if row_before is null then raise exception 'no such invoice in this fleet'; end if;

  -- An ALLOW-LIST, so a key nobody meant to expose cannot be written by
  -- posting it. Same direction of failure as the role menus.
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(allowed)) then
      raise exception 'field % cannot be edited here', k;
    end if;
  end loop;

  update public.su_invoices i set
    supplier     = coalesce(p_patch->>'supplier', i.supplier),
    invoice_no   = case when p_patch ? 'invoice_no' then nullif(p_patch->>'invoice_no','') else i.invoice_no end,
    invoice_date = case when p_patch ? 'invoice_date' then nullif(p_patch->>'invoice_date','')::date else i.invoice_date end,
    net          = case when p_patch ? 'net'   then nullif(p_patch->>'net','')::numeric   else i.net end,
    vat          = case when p_patch ? 'vat'   then nullif(p_patch->>'vat','')::numeric   else i.vat end,
    total        = case when p_patch ? 'total' then nullif(p_patch->>'total','')::numeric else i.total end,
    currency     = case when p_patch ? 'currency' then nullif(p_patch->>'currency','') else i.currency end,
    description  = case when p_patch ? 'description' then nullif(p_patch->>'description','') else i.description end,
    page_from    = case when p_patch ? 'page_from' then nullif(p_patch->>'page_from','')::int else i.page_from end,
    page_to      = case when p_patch ? 'page_to'   then nullif(p_patch->>'page_to','')::int   else i.page_to end
  where i.id = p_id and i.fleet_id = f;

  select to_jsonb(i) into row_after from public.su_invoices i where i.id = p_id;

  insert into public.su_invoice_changes (fleet_id, invoice_id, action, before, after, reason, changed_by)
  values (f, p_id, 'edit', row_before, row_after, nullif(btrim(coalesce(p_reason,'')), ''), auth.uid());

  return row_after;
end $$;

revoke all on function public.su_delete_invoice(uuid, text) from public, anon;
revoke all on function public.su_edit_invoice(uuid, jsonb, text) from public, anon;
grant execute on function public.su_delete_invoice(uuid, text) to authenticated;
grant execute on function public.su_edit_invoice(uuid, jsonb, text) to authenticated;

-- Probed as a throwaway officer and a throwaway skipper, in an aborted
-- transaction: officer delete refused, officer edit refused, skipper edit
-- applied, a field off the allow-list refused, delete removed the row and left
-- TWO trail entries (the edit and the delete) with the whole row in `before`.
--
-- No entry is needed in officer_role.sql or cook_role.sql: `su_invoices`
-- already carries `officer_no_access` and `cook_no_access`, and the new table
-- is denied to everyone but the service key and a skipper's own SELECT.
