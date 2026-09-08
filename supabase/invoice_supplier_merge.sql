-- MERGING TWO SPELLINGS OF ONE FIRM.
-- Applied Sep 2026 as migration `su_merge_invoice_suppliers`.
--
-- The eighth instance of the pattern this codebase keeps meeting: crew_ranks,
-- fuel suppliers, vessel labels, buyer names, the quantity notation, the stores
-- units, pack sizes -- anything typed rather than picked will drift. Invoice
-- supplier names are worse than any of them, because they come off a MODEL
-- READING A PHOTOGRAPH: "MAN Diesel & Turbo" and "MAN Diesel & Turbo
-- (Frederikshavn)" are one firm and one branch, and `normaliseSupplier`
-- deliberately refuses to guess that, because welding two genuinely different
-- firms together is not recoverable once the invoice that would tell them apart
-- is filed under the wrong name.
--
-- So a merge is a DECISION A PERSON MAKES, and this is the machinery for
-- carrying it out safely.
--
-- THE ALIAS IS THE POINT, not the tidying. Moving the invoices fixes history;
-- recording the losing name as an alias on the survivor is what stops the next
-- bundle re-creating the firm under the same spelling next Monday. A merge that
-- did only the first half would have to be done again every few weeks.

create or replace function public.su_merge_invoice_suppliers(
  p_keep uuid, p_drop uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid := current_fleet_id();
  keep record;
  gone record;
  moved int;
  names text[];
begin
  if f is null then raise exception 'no fleet in scope'; end if;
  if not exists (select 1 from public.app_users u
                 where u.id = auth.uid() and u.role = 'skipper') then
    raise exception 'only the skipper may merge two firms';
  end if;
  if p_keep = p_drop then raise exception 'those are the same firm'; end if;

  /* BOTH SCOPED ON FLEET. SECURITY DEFINER bypasses RLS, so the boundary is
     written here -- and this app holds an agent grant over another business's
     boat, which is a read and must never decide what gets written. */
  select * into keep from public.su_invoice_suppliers where id = p_keep and fleet_id = f;
  if keep is null then raise exception 'the firm to keep is not in this fleet'; end if;
  select * into gone from public.su_invoice_suppliers where id = p_drop and fleet_id = f;
  if gone is null then raise exception 'the firm to merge is not in this fleet'; end if;

  /* EVERY SPELLING THE LOSING ROW ANSWERED TO COMES ACROSS, not just its name.
     It may itself have been merged once, and dropping its alias list would
     re-open a firm that was closed months ago. */
  names := array(
    select distinct x from unnest(
      coalesce(keep.aliases, '{}'::text[])
      || coalesce(gone.aliases, '{}'::text[])
      || array[gone.name]
    ) as x
    where x is not null and btrim(x) <> '' and lower(btrim(x)) <> lower(btrim(keep.name))
  );

  update public.su_invoices set supplier_id = p_keep
   where supplier_id = p_drop and fleet_id = f;
  get diagnostics moved = ROW_COUNT;

  update public.su_invoice_suppliers set aliases = names where id = p_keep;
  delete from public.su_invoice_suppliers where id = p_drop and fleet_id = f;

  return jsonb_build_object(
    'kept', keep.name, 'merged', gone.name, 'invoices_moved', moved, 'aliases', names);
end $$;

revoke all on function public.su_merge_invoice_suppliers(uuid, uuid) from public, anon;
grant execute on function public.su_merge_invoice_suppliers(uuid, uuid) to authenticated;


-- THE SIX DAVID CALLED, Sep 2026 -------------------------------------------
--
--   George West Limited      <- George West Ltd (E-Catch)          2 moved
--   FedEx Express            <- FedEx Express UK Transportation    2 moved
--   D. Steven & Son          <- D. Steven & Son Haulage Contractors 5 moved
--   Banff Tyre Services      <- Banff Tyre Services / County Garage 3 moved
--   MAN Diesel & Turbo       <- MAN Diesel & Turbo (Frederikshavn)  2 moved
--   Seaway Net Company       <- Seaway Group                        1 moved
--
-- Run through this function as his own login rather than as the service role,
-- so the skipper check and the fleet scoping were actually exercised.
--
-- suppliers 217 -> 211 · invoices 3,266 unchanged · GBP 10,974,858.45 unchanged
-- · 0 invoices orphaned · 0 left without a firm · no two firms now share a
-- normalised name.
--
-- NOTHING MOVED BETWEEN CATEGORIES, checked before running: both rows in each
-- pair already carried the same category (office, freight, freight, vehicle,
-- engine, gear), so no year's trade totals changed.
--
-- AND `Steven Clark Motor Body Repairs` IS A DIFFERENT FIRM. It matches a
-- search for "steven" and is a man's name, not D. Steven & Son. Left alone --
-- which is the whole reason a merge is a decision rather than a rule.
