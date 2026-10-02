/* "THE WORK WAS DONE WHEN IT WAS BILLED" — asked, and answered. Sep 2026.
 * Applied as migration invoice_worked_as_billed.
 *
 * David: *"invoices, when saving the lump invoices to the year, it's not saving.
 * sort that. put them into the year they were billed. to the exact date they were
 * invoiced."*
 *
 * THE SAVE WAS A LOST BACKSLASH, not a permission and not this column.
 * `dateOrNull` in src/lib/su/invoices.js read
 *
 *     /^d{4}-d{2}-d{2}$/
 *
 * — the escapes eaten writing the file — so it matched the letters "dddd-dd-dd"
 * and returned null for every real date. `setInvoicesWork` then wrote null over
 * null: the UPDATE ran, touched the rows, changed nothing, and the page said it
 * had saved. **No work date had ever been saved through the app.** The nine on
 * record were written by hand in SQL during the 13-10-2025 bundle work, which is
 * why the feature looked like it had been working all along. Fourth lost
 * backslash in this repo and the first to cost data rather than break visibly;
 * scripts/find-eaten-escapes.mjs scans for the shape and runs in `npm test`.
 *
 * SO WHY A COLUMN AND NOT A COPIED DATE? Because the answer he wants — the work
 * was done about when it was billed — has to be recorded, and writing the invoice
 * date into `work_from` would be indistinguishable from a date somebody read off
 * the document. That is the documented failure mode of this whole feature: the
 * reader's prompt is mostly negative rules about it and `fixWorkDates` strips a
 * work date equal to the invoice date. Copy it here and the page would claim 95
 * invoices state when the work was done when nine of them do, and the "dated by
 * work" grid would be a copy of the billed one with nothing saying why.
 *
 * So `work_from` keeps meaning "read off the invoice", `work_as_billed` means
 * "asked, and there is nothing to read", and the two are counted apart on the
 * panel. The cost needs no date at all: `dateBasisOf` already falls back to the
 * invoice date, so it counts in the billed year on the exact invoice date — which
 * is where it already was. Nothing moves; the group stops being asked about.
 *
 * A DECISION AND A DEFAULT MUST NOT READ ALIKE — the vessel-era rule, where the
 * invoices that agreed with the default were written down explicitly anyway, and
 * that is what took them off the undecided list for good.
 *
 * APPLIED TO THE WHOLE LIST on his instruction: 32 groups, 86 invoices,
 * £2,260,901.01, 31-12-2016 to 22-06-2026. No year total moved, by construction.
 * Undone with:
 *
 *     update public.su_invoices set work_as_billed = null where work_as_billed;
 */
alter table public.su_invoices add column if not exists work_as_billed boolean;

comment on column public.su_invoices.work_as_billed is
  'Skipper answered the lump-billing question: the work was done when it was billed, so this counts on its invoice date. NULL = not asked. Never set by the reader — work_from/work_to are for dates actually printed on the document.';

/* Both at once is a contradiction: one says the work has its own dates, the
 * other says it does not. */
alter table public.su_invoices drop constraint if exists su_invoices_work_answer_once;
alter table public.su_invoices add constraint su_invoices_work_answer_once check (
  work_as_billed is not true or (work_from is null and work_to is null)
);
