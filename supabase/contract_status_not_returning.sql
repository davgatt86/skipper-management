/* A MAN WHO WENT HOME AND IS NOT COMING BACK. Sep 2026.
 *
 * David: *"[a crewman] decided to not return. but it won't let me click to say
 * did not return."* The status enum had three values — current, pending_return,
 * completed — so the only way out of "gone home" was **Returned**, which records
 * a return that never happened and makes the second half of the going-home bonus
 * due. See supabase/bonus_alerts_follow_the_return.sql for what that half does
 * instead (forfeited outright, David's word).
 *
 * TWO STATEMENTS, AND THEY MUST BE SEPARATE TRANSACTIONS. A value added to an
 * enum cannot be used in the same transaction that added it, which is why the
 * constraint below was applied as its own migration rather than beside it.
 *
 * THE SECOND HALF IS THE BUG WORTH REMEMBERING. Adding the value to the enum
 * looked like the whole job, and the button still did nothing for a day:
 * `check_status_consistency` ENUMERATES THE STATUSES BY NAME, so it had never
 * heard of `not_returning`, matched neither of its branches, and the database
 * refused every attempt. An enum and a CHECK that lists its values are two copies
 * of one list, and the second does not follow the first. Grep for the enum's name
 * in constraint definitions before believing a new value is usable:
 *
 *   select conname, pg_get_constraintdef(oid) from pg_constraint
 *    where conrelid = 'public.contracts'::regclass and contype = 'c';
 *
 * It failed silently to the skipper on top of that, because the page's error
 * banner is above a list of nineteen contracts and the refusal scrolled past
 * unseen. Fixed in Contracts.jsx: a failed row action names what did not happen
 * and scrolls itself into view.
 */

-- Applied 29-09-2026 as migration contract_status_not_returning.
alter type contract_status add value if not exists 'not_returning';

-- Applied 29-09-2026 as migration contract_status_consistency_knows_not_returning,
-- a separate transaction because of the enum rule above.
alter table public.contracts add column if not exists not_returning_on date;

alter table public.contracts drop constraint if exists check_status_consistency;
alter table public.contracts add constraint check_status_consistency check (
  (status = 'current' and end_date is null)
  or (status in ('completed', 'pending_return', 'not_returning') and end_date is not null)
);

/* The date belongs to that status and nowhere else. It is NOT required there:
 * "we know he is not coming back and nobody wrote down when we were told" is an
 * honest row, and a fabricated date would be worse than a null. */
alter table public.contracts drop constraint if exists check_not_returning_on;
alter table public.contracts add constraint check_not_returning_on check (
  not_returning_on is null or status = 'not_returning'
);
