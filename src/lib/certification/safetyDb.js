/* Reading and writing risk assessments, and lifting and work equipment.
 *
 * UNLIKE THE TWO STATUTORY BOOKS, THESE MAY BE CORRECTED. The Oil Record Book
 * and the Official Log Book have no update path anywhere, because their
 * regulations allow one remedy only. These are working documents: a typo in a
 * control measure should be put right, not superseded by a whole new
 * assessment. What is NOT edited is an assessment that has been reviewed —
 * `reviewAssessment` writes a new one and points the old at it, so what the
 * crew were briefed on last year still says what they were briefed on.
 */

import { supabase } from '../../supabaseClient'

const RA = 'id, fleet_id, vessel_id, ref, title, area, assessed_on, assessed_by,'
  + ' review_due, supersedes_id, withdrawn_on, withdrawn_why, notes, created_at,'
  + ' source_file'
const HAZ = 'id, fleet_id, assessment_id, hazard, who_at_risk, controls, likelihood,'
  + ' severity, further_action, action_by, action_due, done_on, sort,'
  + ' consequence, source_level'
const BRIEF = 'id, fleet_id, assessment_id, briefed_on, crew_name, briefed_by'
const EQ = 'id, fleet_id, vessel_id, name, kind, identifier, swl, location,'
  + ' in_service_on, out_of_service_on, scheme_months, scheme_by, notes, created_at'
const EX = 'id, fleet_id, equipment_id, examined_on, kind, competent_person, organisation,'
  + ' result, defects, next_due, report_ref, file_path, recorded_by, recorded_at'

/* ---- risk assessments --------------------------------------------------- */

export async function listAssessments(vesselId) {
  let q = supabase.from('risk_assessments').select(RA).order('assessed_on', { ascending: false })
  /* A risk assessment is often about the WORK rather than the hull — lifting,
     shooting the net, working with chemicals — so one with no vessel is a real
     state and must not be filtered out when a boat is chosen. */
  if (vesselId) q = q.or(`vessel_id.eq.${vesselId},vessel_id.is.null`)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function listHazards() {
  const { data, error } = await supabase.from('risk_assessment_hazards').select(HAZ).order('sort')
  if (error) throw error
  return data || []
}

export async function listBriefings() {
  const { data, error } = await supabase.from('risk_assessment_briefings').select(BRIEF)
    .order('briefed_on', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveAssessment(a) {
  const row = {
    vessel_id: a.vesselId || null,
    ref: text(a.ref),
    title: String(a.title || '').trim(),
    area: text(a.area),
    assessed_on: a.assessedOn,
    assessed_by: String(a.assessedBy || '').trim(),
    review_due: a.reviewDue || null,
    notes: text(a.notes),
    source_file: text(a.sourceFile),
  }
  const q = a.id
    ? supabase.from('risk_assessments').update(row).eq('id', a.id)
    : supabase.from('risk_assessments').insert(row)
  const { data, error } = await q.select(RA).single()
  if (error) throw error
  return data
}

/**
 * REVIEWING MAKES A NEW ASSESSMENT. It copies the hazards forward so the work
 * is not retyped, and points the new one at the old with `supersedes_id`.
 *
 * The old row is left exactly as it was. An assessment rewritten in place
 * cannot be relied on afterwards to say what was in force at the time of an
 * accident, which is the only moment anybody will ever ask.
 */
export async function reviewAssessment(previous, hazards, { assessedOn, assessedBy, reviewDue }) {
  const { data: fresh, error } = await supabase.from('risk_assessments').insert({
    vessel_id: previous.vessel_id,
    ref: previous.ref,
    title: previous.title,
    area: previous.area,
    assessed_on: assessedOn,
    assessed_by: String(assessedBy || '').trim(),
    review_due: reviewDue || null,
    supersedes_id: previous.id,
    notes: previous.notes,
  }).select(RA).single()
  if (error) throw error

  const carry = (hazards || []).filter((h) => h.assessment_id === previous.id)
  if (carry.length) {
    const { error: he } = await supabase.from('risk_assessment_hazards').insert(
      carry.map((h) => ({
        assessment_id: fresh.id,
        hazard: h.hazard, who_at_risk: h.who_at_risk, controls: h.controls,
        likelihood: h.likelihood, severity: h.severity,
        /* THE ACTIONS DO NOT COME ACROSS AS DONE. An action closed last year
           was closed on last year's assessment; carrying `done_on` forward
           would make this year's review claim work that this year's review has
           not looked at. The action itself carries over so it is considered
           again; whether it is still outstanding is answered afresh. */
        further_action: h.further_action, action_by: h.action_by,
        action_due: null, done_on: null,
        sort: h.sort,
      })))
    if (he) throw he
  }
  return fresh
}

export async function saveHazard(assessmentId, h) {
  const row = {
    assessment_id: assessmentId,
    hazard: String(h.hazard || '').trim(),
    who_at_risk: text(h.whoAtRisk),
    controls: text(h.controls),
    likelihood: intOrNull(h.likelihood),
    severity: intOrNull(h.severity),
    /* Aegir's two consequence columns folded into one, and its worded level
       kept as text so an imported hazard can be rated FROM it. Never converted:
       see risk_hazard_consequence_and_source_level.sql. */
    consequence: text(h.consequence),
    source_level: text(h.sourceLevel),
    further_action: text(h.furtherAction),
    action_by: text(h.actionBy),
    action_due: h.actionDue || null,
    done_on: h.doneOn || null,
    sort: intOrNull(h.sort) ?? 0,
  }
  const q = h.id
    ? supabase.from('risk_assessment_hazards').update(row).eq('id', h.id)
    : supabase.from('risk_assessment_hazards').insert(row)
  const { data, error } = await q.select(HAZ).single()
  if (error) throw error
  return data
}

export async function removeHazard(id) {
  const { error } = await supabase.from('risk_assessment_hazards').delete().eq('id', id)
  if (error) throw error
}

/** "The significant findings ... shall be brought to the notice of workers." */
export async function recordBriefing(assessmentId, { briefedOn, crewName, briefedBy }) {
  const { data, error } = await supabase.from('risk_assessment_briefings').insert({
    assessment_id: assessmentId,
    briefed_on: briefedOn,
    crew_name: String(crewName || '').trim(),
    briefed_by: text(briefedBy),
  }).select(BRIEF).single()
  if (error) throw error
  return data
}

/* ---- lifting and work equipment ----------------------------------------- */

export async function listEquipment(vesselId) {
  let q = supabase.from('work_equipment').select(EQ).order('name')
  if (vesselId) q = q.or(`vessel_id.eq.${vesselId},vessel_id.is.null`)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function listExaminations() {
  const { data, error } = await supabase.from('equipment_examinations').select(EX)
    .order('examined_on', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveEquipment(e) {
  const row = {
    vessel_id: e.vesselId || null,
    name: String(e.name || '').trim(),
    kind: e.kind,
    identifier: text(e.identifier),
    swl: text(e.swl),
    location: text(e.location),
    in_service_on: e.inServiceOn || null,
    out_of_service_on: e.outOfServiceOn || null,
    /* Null, never 0. `Number('') === 0` has bitten this repo six times, and a
       scheme of nought months would make everything permanently overdue. */
    scheme_months: intOrNull(e.schemeMonths),
    scheme_by: text(e.schemeBy),
    notes: text(e.notes),
  }
  const q = e.id
    ? supabase.from('work_equipment').update(row).eq('id', e.id)
    : supabase.from('work_equipment').insert(row)
  const { data, error } = await q.select(EQ).single()
  if (error) throw error
  return data
}

export async function recordExamination(equipmentId, x) {
  const { data, error } = await supabase.from('equipment_examinations').insert({
    equipment_id: equipmentId,
    examined_on: x.examinedOn,
    kind: x.kind || 'thorough',
    competent_person: String(x.competentPerson || '').trim(),
    organisation: text(x.organisation),
    result: x.result || 'satisfactory',
    defects: text(x.defects),
    /* WHAT THE REPORT SAYS, not what the statute allows. The two are compared
       in `equipmentState` and a disagreement is reported, never resolved. */
    next_due: x.nextDue || null,
    report_ref: text(x.reportRef),
    file_path: x.filePath || null,
    recorded_by: x.userId || null,
  }).select(EX).single()
  if (error) throw error
  return data
}

const text = (v) => (String(v ?? '').trim() || null)
function intOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isInteger(n) ? n : null
}
