-- AUCTION OR PRIVATE, AND LANDED OR CONSIGNED (Nov 2026)
--
-- David: *"some will be consigned, some will be private, some will be landed
-- in PD"*. The note carries all three -- but NOT as three values of one field.
-- They are TWO independent facts printed on two different lines:
--
--   the port line     "Landed Peterhead 20-May-2026"  /  "Consigned Ullapool ..."
--   the vessel line   "The Don Fishing Co Ltd - Pd AUDACIOUS BF83 - Private"
--
-- All four combinations occur across the 109 notes on disk -- landed/auction
-- 43, landed/private 34, consigned/auction 16, consigned/private 16 -- so one
-- enum would have been wrong for half of them.
--
-- AND PRIVATE EXPLAINS THE DATE GAP that date_basis was built around:
--
--     auction   sold === landed on 57 of 57
--     PRIVATE   sold  <>  landed on 50 of 50, by 1 to 10 days
--
-- An auction lot sells the morning it lands; a private sale goes directly,
-- days later. The parser comment recorded this as "the small tail notes" and
-- called it a correlate rather than a cause. This is the cause.
--
-- sale_type IS NULL ON EVERY OTHER MARKET, deliberately. Only Don prints the
-- distinction; Shetland, Hanstholm, LHD and P&J do not, and 'auction' there
-- would be a claim nobody made. It is null on an unread Don note too, which is
-- 133 of them -- the notes are not on this machine and nothing else says.

alter table public.sales_landings add column if not exists sale_type text;

alter table public.sales_landings drop constraint if exists sales_landings_sale_type_chk;
alter table public.sales_landings add constraint sales_landings_sale_type_chk
  check (sale_type is null or sale_type in ('auction', 'private'));

comment on column public.sales_landings.sale_type is
  'How it sold, off the Don note vessel line: auction, or private (the " - Private" suffix). Null on any market that does not print it, and on a note nobody has read.';

-- 1. FRASERBURGH WAS NEVER IN THE PORT LIST. parseDon matched the port
--    against five hard-coded names, so a note reading "Consigned Fraserburgh"
--    fell through to the "Peterhead" default -- the wrong port, which also made
--    it read as landed. 1.4.1 takes the port off the line itself; these two
--    were filed before that.
update public.sales_landings set port = 'Fraserburgh'
 where sale_no in ('3353319', '3353300') and market like 'Don Fishing%';

-- 2. HOW IT SOLD, read off the 109 notes still on disk.
--
--    KEYED ON (VESSEL, SALE_NO), AND THE FIRST GO AT THIS WAS KEYED ON THE
--    SALE NUMBER ALONE -- which is wrong, and was caught by asking whether any
--    number spanned two fleets. Fifteen do: Don's sale numbers run across the
--    whole agent, so one number covers several boats' notes on the same day and
--    EACH carries its own " - Private" marker. Keyed on the number alone,
--    "private" read off the Audacious note was written onto Beryl's and Boy
--    Andrew's landings. Same fault as the invoice re-priced into euros because
--    an invoice number is only unique within a firm.
--
--    Only three boats' notes are on this machine, so only those three are
--    stamped. The eight TEST FLEET rows that also match came off these very
--    files -- same filenames, same sale numbers -- so they are read, not
--    inferred.
update public.sales_landings set sale_type = null where sale_type is not null;

update public.sales_landings set sale_type = 'auction'
 where market like 'Don Fishing%' and vessel = 'AUDACIOUS BF83' and sale_no in (
    '3345237','3345657','3347637','3350457','3350837','3350997','3351157','3351457',
    '3351597','3351717','3351777','3351837','3352037','3352077','3352183','3352397',
    '3352457','3352558','3352698','3352797','3352841','3352874','3352937','3353077',
    '3353278','3353300','3353620','3353667','3353707','3353837','3353878','3353958',
    '3354077','3354198','3354258','3354278','3354311','3354346','3354438','3354478',
    '3354617','3354697','3355017','3355237','3355281','3355418','3356045','3356145',
    '3356618'
 );

update public.sales_landings set sale_type = 'private'
 where market like 'Don Fishing%' and vessel = 'AUDACIOUS BF83' and sale_no in (
    '3345177','3345697','3347497','3347677','3349937','3350497','3350637','3350817',
    '3350877','3351018','3351177','3351462','3351537','3351637','3351737','3351817',
    '3351897','3352097','3352117','3352189','3352429','3352479','3352597','3352717',
    '3352809','3352857','3352877','3352980','3353081','3353157','3353197','3353299',
    '3353319','3353662','3353702','3353739','3353864','3353882','3353921','3353997',
    '3354097','3354202','3354279','3354283','3354341','3354355','3354457','3354497',
    '3354700','3354724'
 );

update public.sales_landings set sale_type = 'auction'
 where market like 'Don Fishing%' and vessel = 'BOY JOHN INS110' and sale_no in (
    '3355109','3355198','3355244','3355286','3356678'
 );

update public.sales_landings set sale_type = 'auction'
 where market like 'Don Fishing%' and vessel = 'ROSEBLOOM INS353' and sale_no in (
    '3355109','3355198','3355244','3355286','3356678'
 );

-- 3. LANDED OR CONSIGNED, for every Don landing. The port decides it: Don is a
--    Peterhead agent, so the boat either lands there or is consigned to it from
--    somewhere else. That held on all 109 notes read, both ways, and step 1 has
--    already put the only wrong ports right.
--
--    This supersedes consigned being TRUE on all 266 Don landings, which was
--    the whole-note test matching the column HEADING "LANDED / CONSIGNED PORT".
--    After: 201 landed, 67 consigned.
update public.sales_landings
   set consigned = (coalesce(nullif(port, ''), 'Peterhead') <> 'Peterhead')
 where market like 'Don Fishing%' or market like 'John S Duncan%';
