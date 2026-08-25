-- Gear measurements taken in TWO HALVES AND AN OVERALL (Aug 2026).
--
-- David: "when measuring a headline/footrope/ground gear we do in 2x halves &
-- total overall."
--
-- He was already doing it. The ground-gear measurement of 19-08-2026 carries
--
--     Stb 60'3"/Port 60'5"
--
-- typed into the NOTES of a separate `inspected` row, because the form had
-- nowhere else to put it -- and 60'3" plus 60'5" is exactly the 120'8" of that
-- day's `measured` row. This turns his method into data instead of prose.
--
-- THE OVERALL STAYS IN `value`. It is the figure every existing reader already
-- uses -- the matrix cell, the wear series, gearStats -- so nothing changes
-- shape for the 19 measurements already logged, and a part measured the old way
-- keeps working exactly as before. The halves are additive.
--
-- THE OVERALL IS NOT DERIVED FROM THE HALVES, and there is deliberately no
-- generated column or trigger making it so. It is a third act of measuring
-- along the whole rope, so it can disagree with the two halves, and when it
-- does one of the three is wrong. That disagreement is the check the paper
-- method could never make; computing the total away would destroy it.
--
-- Both are stored as written AND in millimetres, the same rule as `value` /
-- `value_mm`: a series has to survive the unit changing partway through it.
-- The unit is shared -- nobody measures port in feet and starboard in metres.

alter table public.gear_measurements
  add column if not exists port_value numeric,
  add column if not exists stbd_value numeric,
  add column if not exists port_mm    numeric,
  add column if not exists stbd_mm    numeric;

comment on column public.gear_measurements.port_value is
  'Port half as written, in the row''s `unit`. The overall stays in `value` and is measured separately, never derived from the halves.';
comment on column public.gear_measurements.stbd_value is
  'Starboard half as written, in the row''s `unit`.';

-- Whether a part is measured in halves is the BOAT'S to say, like the market
-- clocks and the stores units. Null means "keep the shipped answer", so a
-- correction to the shipped list still reaches a fleet that has overridden
-- something else about that part.
alter table public.gear_parts
  add column if not exists halves boolean;

comment on column public.gear_parts.halves is
  'Override for whether this part is measured in two halves. NULL keeps the shipped default (ground gear, footrope and headline are halved; bridles, legs and codend are not).';

-- A half cannot be negative. Only a length, never a direction.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gear_measurements_halves_nonneg') then
    alter table public.gear_measurements
      add constraint gear_measurements_halves_nonneg
      check (
        (port_value is null or port_value >= 0)
        and (stbd_value is null or stbd_value >= 0)
        and (port_mm   is null or port_mm   >= 0)
        and (stbd_mm   is null or stbd_mm   >= 0)
      );
  end if;
end $$;

-- ONE HALF ON ITS OWN IS ALLOWED, deliberately. A man who measured the port
-- side before the weather came in has a real reading, and refusing it would
-- lose it. Nothing is inferred from a single half -- `halvesCheck` returns no
-- sum, no imbalance and no total until both are present.
--
-- No CHECK ties the halves to a halved part: `part_key` lives on
-- `gear_components`, and a CHECK cannot run a subquery. Same reason the
-- cross-fleet vessel guard is a composite FK rather than a CHECK. The page
-- only offers the boxes where the part is halved.
