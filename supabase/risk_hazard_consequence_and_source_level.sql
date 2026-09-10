-- Two columns the imported assessments need and the app did not have.
--
-- `consequence` — Aegir's sheet carries TWO columns this app has none of, "Risk"
-- and "Risk Outcomes", and between them they are the half of the document that
-- says why the hazard matters. Folded into one field rather than dropped.
--
-- `source_level` — the worded Low/Medium/High off the original. David asked for
-- the imported hazards to be left UNRATED so he can rate them himself, and this
-- is what he will rate them FROM. It is kept as TEXT and never turned into a
-- likelihood and a severity: a Low/Medium/High converted into numbers would be
-- an invention wearing his own judgement's clothes, and `rating()` would then
-- report it as if somebody had scored it.
--
-- Both nullable, so every hazard already on record reads exactly as before.
alter table public.risk_assessment_hazards
  add column if not exists consequence text,
  add column if not exists source_level text;

comment on column public.risk_assessment_hazards.consequence is
  'What happens if the hazard is realised. Free text; on imported assessments '
  'this is the source document''s Risk and Risk Outcomes columns joined.';

comment on column public.risk_assessment_hazards.source_level is
  'The worded risk level on the document this hazard was imported from, kept '
  'for reference while it is rated. Never converted into likelihood/severity.';

-- Where an imported assessment came from, so a second import of the same file
-- can be recognised rather than duplicating eighty hazards.
alter table public.risk_assessments
  add column if not exists source_file text;

comment on column public.risk_assessments.source_file is
  'File name this assessment was read from, where it was imported rather than '
  'typed. Null for one written in the app.';
