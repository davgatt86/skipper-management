-- BOAT INVOICES — the weekly bundle, split by supplier  (Sep 2026)
--
-- David: "i get them scanned and emailed to me every monday by denise nicolson
-- don company ... catagorise them by type, supplier, monthly, quarterly,
-- annually", then "splitting is what we want, do whatever it needs to have it
-- split by supplier" and "just reporting periods. annual is most important."
--
-- WHAT ACTUALLY ARRIVES, measured off twelve real emails rather than assumed:
--
--   every Monday, denise.nicolson@donfishing.com
--   subject  "Audacious invoices for approval"
--   ONE pdf holding the WHOLE WEEK's invoices — 0.7-2.3 MB, 5 pages
--   named by the scanner clock: 20260831082919614.pdf
--
-- The 20-07 bundle probed: **0 fonts, 4 DCTDecode images, 0 characters of
-- text**. It is a photograph, exactly like a settling sheet, so no parser will
-- ever read it — it needs the model, and it needs the same review-before-save
-- discipline, because a misread supplier is a miscategorised cost for ever.
--
-- ============================================================================
-- `su_invoices` ALREADY EXISTED, and this migration is additive because of it.
-- ============================================================================
--
-- Found by the first attempt failing on "column fleet_id does not exist":
-- `create table if not exists` had quietly skipped a table that was already
-- there with a different shape. It carries FOUR REAL AUDACIOUS INVOICES from
-- July 2026 — John A Smith & Sons £218.40, AFPO quota lease £437.40, Jackson
-- Trawls £5,200, Seagate Fabrication £1,272.25 — each with its own file.
--
-- It comes from outside this repo, almost certainly `square-up-fleet-
-- settlements`, which this file has long named as "the one thing that could
-- still be writing to this database". So EVERY COLUMN ADDED HERE IS NULLABLE
-- and nothing is renamed or dropped: that app must keep working.
--
-- It also means there is no second invoices table, which is the outcome worth
-- having. Two tables for one idea is the failure this codebase keeps recording
-- — the two parser copies that silently ran different versions for months.
--
-- The existing columns map onto what was wanted almost exactly:
--   supplier  = the name as read      total = the gross
--   invoice_no, invoice_date, net, vat, description, file_path, status
-- so what is added is only what is genuinely new: which BUNDLE an invoice came
-- out of, which canonical SUPPLIER it belongs to, and which PAGES it is.

-- ---- the arrival: one row per email --------------------------------------
create table if not exists public.su_invoice_batches (
  id            uuid primary key default gen_random_uuid(),
  fleet_id      uuid not null references public.fleets(id) on delete cascade,
  boat_id       uuid references public.su_boats(id) on delete set null,

  file_path     text not null,             -- in the su-documents bucket
  filename      text,
  bytes         integer,
  page_count    integer,

  from_email    text,
  subject       text,
  received_at   timestamptz not null default now(),

  /* THE MANAGER'S BALANCE, which exists nowhere else in this app.
   *
   * Denise states it in the body of every one of these emails — "your manager's
   * balance is sitting at just over £413k to the good after settling on Friday"
   * — and it moves week to week against the settling dates. Twelve readings
   * from mid-June alone, one of them £113k the WRONG way after a £336,668
   * scientific quota adjustment. A real running position with the office that
   * has only ever lived in an inbox.
   *
   * Kept as a number AND as the sentence it came from: the reading is a regex
   * over prose a person typed, so the words are the evidence for the figure and
   * have to survive it being wrong. */
  manager_balance      numeric,
  manager_balance_text text,

  status        text not null default 'new'
                  check (status in ('new', 'read', 'filed', 'ignored')),
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists su_invoice_batches_fleet_idx
  on public.su_invoice_batches (fleet_id, received_at desc);

-- ---- the suppliers -------------------------------------------------------
/* ANYTHING TYPED RATHER THAN PICKED WILL DRIFT — the ninth instance in this
 * codebase after crew_ranks, fuel suppliers, vessel labels, buyer names, the
 * stores quantity notation, the stores units, the pack size and the net names.
 *
 * The fuel log is the warning: SEVEN spellings of one firm — "Smith & Sons",
 * "Smith's", "Smith", "Smith & sons", "Smiths &sons", "Smith's & Sons",
 * "John a smith &sons" — 559,938 litres split across names that are almost
 * certainly one company, which makes "who do we buy most fuel from"
 * unanswerable. And the four invoices already in su_invoices include
 * "John A Smith & Sons", which is that same firm again, spelled an eighth way.
 *
 * Here the names come off a MODEL READING A PHOTOGRAPH, so they will drift
 * harder than anything typed. Splitting by supplier is worthless if one firm
 * arrives under four names, so the lookup exists from the first row rather
 * than being retrofitted after the damage. Same shape as sales_buyer_flags. */
create table if not exists public.su_invoice_suppliers (
  id             uuid primary key default gen_random_uuid(),
  fleet_id       uuid not null references public.fleets(id) on delete cascade,
  name           text not null,
  aliases        text[] not null default '{}',
  -- What the boat buys from them. Deliberately carries NO period: a period is
  -- a way of looking at costs, not a property of a firm, and a supplier that is
  -- annual this year and one-off the next would make a tag a lie.
  category       text,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (fleet_id, name)
);

-- ---- what su_invoices gains, all nullable --------------------------------
alter table public.su_invoices
  add column if not exists fleet_id    uuid references public.fleets(id) on delete cascade,
  add column if not exists batch_id    uuid references public.su_invoice_batches(id) on delete set null,
  add column if not exists supplier_id uuid references public.su_invoice_suppliers(id) on delete set null,
  -- Which pages of the bundle this invoice is, so the document can always be
  -- opened at the right place rather than the reader's word being the record.
  add column if not exists page_from   integer,
  add column if not exists page_to     integer,
  add column if not exists currency    text default 'GBP',
  -- What the reader was unsure of, per field, kept beside the figures. A model
  -- reading a photograph is not evidence and must not read like it.
  add column if not exists confidence  jsonb,
  -- The per-invoice overrides. `category` was in the FIRST draft of this file
  -- and lost when it was rewritten to be additive after su_invoices turned out
  -- to already exist — see supabase/invoice_category_override. The fallback to
  -- the supplier's category worked, so nothing ever failed and the override
  -- silently did nothing until somebody tried to use it.
  add column if not exists category    text,
  add column if not exists vessel_era  text;

/* ON DELETE SET NULL for the batch, not CASCADE. Deleting a bundle must not
 * take the invoices read out of it — the cost was incurred whether or not the
 * scan survives, and losing the rows would quietly reduce the year's total.
 * Same rule as parts movements keeping their line when a job is deleted. */

-- Backfill the fleet from the boat, which is where it was already implied.
update public.su_invoices i
   set fleet_id = b.fleet_id
  from public.su_boats b
 where b.id = i.boat_id and i.fleet_id is null;

create index if not exists su_invoices_fleet_date_idx
  on public.su_invoices (fleet_id, invoice_date desc);
create index if not exists su_invoices_supplier_idx
  on public.su_invoices (supplier_id, invoice_date desc);
create index if not exists su_invoices_batch_idx
  on public.su_invoices (batch_id);

-- ---- grants and RLS ------------------------------------------------------
-- New tables need the grant or a new tenant gets permission errors.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.su_invoice_batches   to authenticated;
grant select, insert, update, delete on public.su_invoice_suppliers to authenticated;

alter table public.su_invoice_batches   enable row level security;
alter table public.su_invoice_suppliers enable row level security;

/* The su_* model, same as su_inbox and su_settlements beside them. A new table
 * is open to every tenant from the moment it exists unless this is written
 * first — the permissive policies in this database carry no fleet check of
 * their own, which is what the viewer leak taught. */
drop policy if exists su_invoice_batches_visible on public.su_invoice_batches;
create policy su_invoice_batches_visible on public.su_invoice_batches
  for all to authenticated
  using (boat_id is null or public.su_visible_boat(boat_id))
  with check (boat_id is null or public.su_visible_boat(boat_id));

drop policy if exists su_invoice_batches_fleet on public.su_invoice_batches;
create policy su_invoice_batches_fleet on public.su_invoice_batches
  as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

drop policy if exists su_invoice_suppliers_all on public.su_invoice_suppliers;
create policy su_invoice_suppliers_all on public.su_invoice_suppliers
  for all to authenticated using (true) with check (true);

drop policy if exists su_invoice_suppliers_fleet on public.su_invoice_suppliers;
create policy su_invoice_suppliers_fleet on public.su_invoice_suppliers
  as restrictive for all to authenticated
  using (fleet_id = public.current_fleet_id())
  with check (fleet_id = public.current_fleet_id());

/* su_invoices keeps the policies it already had — `su_is_allowed() AND
 * su_visible_boat(boat_id)` plus the officer and cook denials, which are
 * already in place. Its fleet boundary rides on the boat, exactly as
 * su_settlements does, so nothing here changes who can see the four rows that
 * are in it. */

-- ---- keep updated_at honest ---------------------------------------------
create or replace function public.su_touch_invoice()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists su_invoice_batches_touch on public.su_invoice_batches;
create trigger su_invoice_batches_touch before update on public.su_invoice_batches
  for each row execute function public.su_touch_invoice();

drop trigger if exists su_invoice_suppliers_touch on public.su_invoice_suppliers;
create trigger su_invoice_suppliers_touch before update on public.su_invoice_suppliers
  for each row execute function public.su_touch_invoice();

-- NOTE: deliberately NOT added to the audit trail, for the same reason the rest
-- of su_* is not — these arrive through an edge function on the service-role
-- key, where auth.uid() is null, so the log would record that nobody did it.
--
-- AND: re-run supabase/officer_role.sql and supabase/cook_role.sql after this.
-- Both generate their deny-lists by looping over every table in public, so the
-- two NEW tables are denied to NEITHER role until both are re-run. An invoice
-- is money, and money is the whole reason those two roles exist. `su_invoices`
-- itself already carries both denials.
