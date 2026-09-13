/* THE ENGINE LOG TAKES WHAT THE PAPER SHEET HAD. Sep 2026.
 *
 * David: *"add them all to app"* — every field on the engine room's own paper
 * sheet that the app had no place for. The READINGS need no migration: they live
 * in `engine_logs.readings` (jsonb), so generator oil temp, gearbox oil added,
 * the four refrigeration machines and the four remaining-on-board figures are
 * rows in src/lib/engine/template.js and nothing more.
 *
 * VESSEL OPERATION is the one thing on the sheet that is not a reading —
 * steaming, towing or alongside. A WORD, not a number, and the page's save keeps
 * only numbers in the readings; a reading of "towing" would have been silently
 * dropped. Checked against the three values the sheet prints, so a typo cannot
 * become a fourth state nobody reports on. Nullable: every entry before this, and
 * an older copy of the app still on the boat, simply says nothing.
 *
 * AND `counter_resets` WAS ADDED AND DROPPED IN THE SAME SITTING. Generator 1's
 * counter read 7,396 on paper against 8,864 on record, and the first design was a
 * "meter replaced — count from here" column. David: *"there must be an error by
 * engineer. flag up if counter has been logged lower. it could be he's put as
 * wrong engine and he would then need to edit it."* So a lower counter stays a
 * mistake to be corrected, never a baseline to be reset, and the column went.
 * The drop is kept here so this file matches the database whichever state it
 * meets.
 */

alter table public.engine_logs
  add column if not exists vessel_operation text;

alter table public.engine_logs drop column if exists counter_resets;

alter table public.engine_logs drop constraint if exists engine_logs_vessel_operation_known;
alter table public.engine_logs add constraint engine_logs_vessel_operation_known
  check (vessel_operation is null or vessel_operation in ('steaming', 'towing', 'alongside'));
