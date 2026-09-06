/* Reading and writing a self-certification.
 *
 * Kept apart from the page for the reason `worksheetShape.js` is: the shaping is
 * what is worth testing, and it cannot be tested through a component that drags
 * the supabase client in behind it.
 */

import { supabase } from '../../supabaseClient'

const CERT = 'id, fleet_id, vessel_id, period, form_code, form_revision, cert_issued_on,'
  + ' started_at, completed_at, declared_by, declared_name, notes'

/** Every self-certification this fleet holds, newest period first. */
export async function listSelfCerts(vesselId) {
  let q = supabase.from('self_certifications').select(CERT).order('period', { ascending: false })
  /* NULL VESSEL MEANS ALL, as everywhere else — a pair team looking at the whole
     fleet should see both boats' certifications, not none. */
  if (vesselId) q = q.eq('vessel_id', vesselId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/** The answers on one certification, keyed by MSF 5550 item number. */
export async function loadAnswers(certId) {
  const { data, error } = await supabase
    .from('self_certification_items')
    .select('id, item_n, state, note, answered_by, answered_at')
    .eq('self_cert_id', certId)
  if (error) throw error
  const byItem = {}
  for (const r of data || []) byItem[r.item_n] = r
  return byItem
}

/**
 * Start one. THE PERIOD AND THE FORM REVISION ARE WRITTEN IN AT THE START and
 * never recomputed: the certificate can be renewed and the MCA can revise the
 * form, and this row has to keep saying what it was actually answering.
 */
export async function startSelfCert({ vesselId, period, certIssuedOn, form }) {
  const { data, error } = await supabase.from('self_certifications').insert({
    vessel_id: vesselId,
    period,
    cert_issued_on: certIssuedOn || null,
    form_code: form.code,
    form_revision: form.revision,
  }).select(CERT).single()
  if (error) throw error
  return data
}

/**
 * Answer one item. Upsert on (self_cert_id, item_n) so changing your mind
 * replaces rather than adds — and the audit trigger records the change, which
 * is the point of it being an update rather than a second row.
 */
export async function answerItem(certId, itemN, state, note, userId) {
  const { error } = await supabase.from('self_certification_items').upsert({
    self_cert_id: certId,
    item_n: itemN,
    state,
    note: note?.trim() || null,
    answered_by: userId || null,
    answered_at: new Date().toISOString(),
  }, { onConflict: 'self_cert_id,item_n' })
  if (error) throw error
}

/** Take an answer back off. An item nobody has been to is not the same as one
 *  answered and then cleared, and the audit trail is where the difference lives. */
export async function clearItem(certId, itemN) {
  const { error } = await supabase.from('self_certification_items')
    .delete().eq('self_cert_id', certId).eq('item_n', itemN)
  if (error) throw error
}

/**
 * Sign it off. SKIPPER ONLY, and that is enforced by RLS rather than here — an
 * officer's update carrying a completed_at is refused by the policy, so hiding
 * the button is presentation and not the boundary.
 *
 * The declared NAME is stored beside the id: an app_users row can be renamed or
 * removed, and a declaration has to keep saying who made it.
 */
export async function completeSelfCert(certId, { userId, name, notes }) {
  const { data, error } = await supabase.from('self_certifications').update({
    completed_at: new Date().toISOString(),
    declared_by: userId || null,
    declared_name: name || null,
    notes: notes?.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq('id', certId).select(CERT).single()
  if (error) throw error
  return data
}
