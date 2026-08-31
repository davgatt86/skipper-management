-- BOND ITEMS BECOME WORKSHEET LINES  (Aug 2026)
--
-- Until now a worksheet stored bond only as each man's TOTAL, folded onto his
-- `su_worksheet_crew` row. Two consequences, and the second one loses money:
--
--   * the ITEMISATION was gone on reload — a man's four bottles came back as
--     one line for their sum;
--   * a bond item assigned to NOBODY hung off no crew row at all, so it was
--     not kept ANYWHERE. Save the sheet, come back, and the unallocated baccy
--     had simply left the record.
--
-- David, Aug 2026: "some of the bond isn't allocated ... i want that to roll
-- over onto next worksheet + any new bond that's uploaded."
--
-- Rolling it over is only safe if it survives being saved, so the item itself
-- is now a line. `detail` carries the assignment:
--
--     crew:<sort>   the crewman at that position on this worksheet
--     stores        the boat pays
--     carried       unassigned, and it came off an earlier trip
--     null          unassigned
--
-- Nothing is dropped: `su_worksheet_crew.bond` keeps its total as well, so an
-- older sheet with no bond lines still reads back exactly as it did.
alter table public.su_worksheet_lines
  drop constraint if exists su_worksheet_lines_section_check;

alter table public.su_worksheet_lines
  add constraint su_worksheet_lines_section_check
  check (section in ('fuel','haulage','labour','bonus','bond'));
