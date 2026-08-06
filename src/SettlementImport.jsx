import { useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import SectionRule from './SectionRule'
import { parseDocuments, uploadDocument, DOC_TYPES, mapAudacious, mapBeryl } from './lib/su/parse'

// Upload a settling sheet, have the AI reader pull the figures out, check them,
// then save. The check is the point: the reader is a model reading a photo, so
// nothing reaches su_settlements without being looked at.
//
// Totals are shown twice — as printed on the sheet, and as they add up from the
// lines. A missed line shows as a difference instead of silently changing the
// total. Any difference has to be acknowledged before saving.

const num = v => (v === '' || v == null ? 0 : Number(String(v).replace(/[^0-9.-]/g, '')) || 0)
const gbp2 = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const TOL = 0.01

export default function SettlementImport({ boat, onSaved, onCancel }) {
  const isBeryl = (boat?.format || 'audacious') === 'beryl'
  const [stage, setStage] = useState('pick')      // pick | working | review
  const [busyNote, setBusyNote] = useState('')
  const [error, setError] = useState('')
  const [files, setFiles] = useState([])
  const [storedPaths, setStoredPaths] = useState([])
  const [head, setHead] = useState({})
  const [lines, setLines] = useState([])
  const [crew, setCrew] = useState([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)

  async function read(chosen) {
    setError('')
    setFiles(chosen)
    if (chosen.some(f => /\.(xlsx|xls)$/i.test(f.name))) {
      setError('Spreadsheet templates are not read yet — that part of the Beryl flow has not been ported. Use the PDF or a photo.')
      return
    }
    setStage('working')
    try {
      const docType = isBeryl ? DOC_TYPES.beryl : DOC_TYPES.audacious
      const { data, paths } = await parseDocuments(chosen, docType, boat.id, {
        onStage: s => setBusyNote(s === 'uploading' ? 'Uploading…' : 'Reading the sheet — this can take a minute or two…'),
      })
      const mapped = isBeryl ? mapBeryl(data) : mapAudacious(data)
      setHead(mapped.head)
      setLines(mapped.lines)
      setCrew(mapped.crew)
      setStoredPaths(paths || [])
      setStage('review')
    } catch (e) {
      setError(e.message || String(e))
      setStage('pick')
    }
  }

  // ---- derived: what the lines actually add up to ----
  const secSum = sec => lines.filter(l => l.section === sec).reduce((a, l) => a + num(l.amount), 0)
  const fromLines = useMemo(() => ({
    income: secSum('income'),
    expense: secSum('expense'),
    recovery: secSum('recovery'),
    wages: crew.reduce((a, c) => a + num(c.gross), 0),
  }), [lines, crew])

  const hasSection = sec => lines.some(l => l.section === sec)

  // Only compare where both a sheet figure and lines exist to compare.
  const checks = useMemo(() => {
    const out = []
    const add = (label, sheet, computed, compare) => {
      if (!compare) return
      out.push({ label, sheet, computed, diff: computed - num(sheet) })
    }
    add('Income', head.total_income, fromLines.income, hasSection('income') && head.total_income !== '')
    add('Expenses', head.total_expenses, fromLines.expense, hasSection('expense') && head.total_expenses !== '')
    if (!isBeryl) {
      add('Recoveries', head.total_recoveries, fromLines.recovery, hasSection('recovery') && head.total_recoveries !== '')
      add('Crew wages', head.crew_wages_total, fromLines.wages, crew.length > 0 && head.crew_wages_total !== '')
    }
    return out
  }, [head, fromLines, lines, crew, isBeryl])

  const mismatches = checks.filter(c => Math.abs(c.diff) > TOL)
  const canSave = mismatches.length === 0 || acknowledged

  async function save() {
    setSaving(true)
    setError('')
    try {
      let filePath = storedPaths[0] || null
      if (!filePath && files.length) filePath = await uploadDocument(boat.id, files[0])

      // Store the line-derived figures: a settlement whose own totals do not add
      // up from its own lines is worse than one that disagrees with the paper,
      // and any disagreement has already been shown and acknowledged above.
      const income = hasSection('income') ? fromLines.income : num(head.total_income)
      const expenses = hasSection('expense') ? fromLines.expense : num(head.total_expenses)
      const recoveries = hasSection('recovery') ? fromLines.recovery : num(head.total_recoveries)
      const wages = crew.length ? fromLines.wages : num(head.crew_wages_total)
      const crewOwners = income - expenses - recoveries
      const ownersShare = crewOwners - wages

      const row = isBeryl
        ? {
            boat_id: boat.id, trip_type: 'fishing',
            reference: head.reference || null,
            settling_date: head.settling_date || null,
            total_income: num(head.total_income),
            total_expenses: expenses,
            crew_wages_total: wages,
            boat_share: head.boat_share === '' ? null : num(head.boat_share),
            boat_share_pct: head.boat_share_pct === '' ? null : num(head.boat_share_pct),
            fuel_pct: head.fuel_pct === '' ? null : num(head.fuel_pct),
            commission: head.commission === '' ? null : num(head.commission),
            days_at_sea: head.days_at_sea === '' ? null : num(head.days_at_sea),
            file_path: filePath,
          }
        : {
            boat_id: boat.id, trip_type: head.trip_type || 'fishing',
            reference: head.reference || null,
            settling_date: head.settling_date || null,
            period: head.period || null,
            total_income: income, total_expenses: expenses, total_recoveries: recoveries,
            crew_owners_share: crewOwners, crew_wages_total: wages, owners_share: ownersShare,
            difference: ownersShare - wages,
            cash_generated: recoveries + ownersShare,
            settling_vat: num(head.settling_vat),
            trips: head.trips === '' ? null : num(head.trips),
            days_at_sea: head.days_at_sea === '' ? null : num(head.days_at_sea),
            fuel_used: head.fuel_used === '' ? null : num(head.fuel_used),
            weight_landed: head.weight_landed === '' ? null : num(head.weight_landed),
            notes: head.notes || null,
            file_path: filePath,
          }

      const { data: s, error: sErr } = await supabase.from('su_settlements').insert(row).select().single()
      if (sErr) throw sErr

      const lineRows = lines.filter(l => (l.label || '').trim()).map((l, i) => ({
        settlement_id: s.id, section: l.section, label: l.label.trim(), amount: num(l.amount), sort: i,
      }))
      if (lineRows.length) {
        const { error } = await supabase.from('su_settlement_lines').insert(lineRows)
        if (error) throw error
      }

      const crewRows = crew.filter(c => (c.crew_name || '').trim()).map(c => (isBeryl
        ? { settlement_id: s.id, crew_name: c.crew_name.trim(), gross: num(c.gross), bond: num(c.bond), net: num(c.net), method: 'BACS' }
        : {
            settlement_id: s.id, crew_code: c.crew_code || null, crew_name: c.crew_name.trim(),
            adv: num(c.adv), bond: num(c.bond), gear: num(c.gear), sundries: num(c.sundries),
            add_tax: num(c.add_tax), tax: num(c.tax),
            deductions_total: num(c.adv) + num(c.bond) + num(c.gear) + num(c.sundries) + num(c.add_tax) + num(c.tax),
            gross: num(c.gross), net: num(c.net), method: c.method || 'BACS',
          }))
      if (crewRows.length) {
        const { error } = await supabase.from('su_crew_payments').insert(crewRows)
        if (error) throw error
      }

      onSaved?.(s.id)
    } catch (e) {
      setError(e.message || String(e))
      setSaving(false)
    }
  }

  const setLine = (i, patch) => setLines(ls => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)))
  const setCrewRow = (i, patch) => setCrew(cs => cs.map((c, x) => (x === i ? { ...c, ...patch } : c)))
  const setH = (k, v) => setHead(h => ({ ...h, [k]: v }))

  // ---- pick / working ----
  if (stage !== 'review') {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a settlement</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {boat?.name} {boat?.registration} · {isBeryl ? 'one-page settlement sheet' : 'square-up posting report'}.
          Upload the PDF from the office, or a photo of it.
        </p>
        {error && <p className="error">{error}</p>}
        {stage === 'working' ? (
          <p className="muted"><b>{busyNote}</b> The file is already stored, so nothing is lost if this fails.</p>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="file"
              accept="application/pdf,image/*"
              multiple={!isBeryl}
              style={{ width: 'auto' }}
              onChange={e => { const f = Array.from(e.target.files || []); if (f.length) read(f) }}
            />
            <button className="secondary" onClick={onCancel}>Cancel</button>
          </div>
        )}
      </div>
    )
  }

  // ---- review ----
  return (
    <div>
      <SectionRule side="check before saving">Review what the reader found</SectionRule>

      {error && <div className="card" style={{ borderColor: 'var(--rust)' }}><p className="error">{error}</p></div>}

      {checks.length > 0 && (
        <div className="matchbox" style={{ borderLeftColor: mismatches.length ? 'var(--rust)' : 'var(--kelp)' }}>
          <div className="match-t">Sheet total vs the lines underneath it</div>
          {checks.map(c => (
            <div className="mrow" key={c.label}>
              <span>{c.label}</span>
              <span className="num">sheet {gbp2(c.sheet)}</span>
              <span className="num">lines {gbp2(c.computed)}</span>
              {Math.abs(c.diff) > TOL
                ? <span className="flag bad">{(c.diff > 0 ? '+' : '') + gbp2(c.diff)}</span>
                : <span className="flag ok">Match</span>}
            </div>
          ))}
          {mismatches.length > 0 && (
            <p className="note" style={{ color: 'var(--rust)' }}>
              A difference usually means the reader missed a line, or read one twice.
              Check the lines below against the sheet before saving.
            </p>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="fgrid">
          <label><span className="fl">Reference</span><input value={head.reference || ''} onChange={e => setH('reference', e.target.value)} /></label>
          <label><span className="fl">Settled</span><input type="date" value={head.settling_date || ''} onChange={e => setH('settling_date', e.target.value)} /></label>
          <label><span className="fl">Total income</span><input className="num" value={head.total_income ?? ''} onChange={e => setH('total_income', e.target.value)} /></label>
          <label><span className="fl">Total expenses</span><input className="num" value={head.total_expenses ?? ''} onChange={e => setH('total_expenses', e.target.value)} /></label>
          <label><span className="fl">Days at sea</span><input className="num" value={head.days_at_sea ?? ''} onChange={e => setH('days_at_sea', e.target.value)} /></label>
          {isBeryl
            ? <label><span className="fl">Boat share</span><input className="num" value={head.boat_share ?? ''} onChange={e => setH('boat_share', e.target.value)} /></label>
            : <label><span className="fl">Weight landed</span><input className="num" value={head.weight_landed ?? ''} onChange={e => setH('weight_landed', e.target.value)} /></label>}
        </div>
      </div>

      <SectionRule side={`${lines.length} line${lines.length === 1 ? '' : 's'}`}>Lines</SectionRule>
      <div className="tw">
        <table className="entry">
          <thead><tr><th>Section</th><th>Label</th><th className="r">Amount</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ width: 130 }}>
                  <select value={l.section} onChange={e => setLine(i, { section: e.target.value })}>
                    <option value="income">income</option>
                    <option value="expense">expense</option>
                    <option value="recovery">recovery</option>
                  </select>
                </td>
                <td><input value={l.label || ''} onChange={e => setLine(i, { label: e.target.value })} /></td>
                <td className="r"><input className="num" value={l.amount ?? ''} onChange={e => setLine(i, { amount: e.target.value })} /></td>
                <td className="x" title="Remove" onClick={() => setLines(ls => ls.filter((_, x) => x !== i))}>×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="addrow" onClick={() => setLines(ls => [...ls, { section: 'expense', label: '', amount: '' }])}>+ Add line</button>

      <SectionRule side={`${crew.length} crew`}>Crew wages</SectionRule>
      <div className="tw">
        <table className="entry">
          <thead>
            <tr><th>Name</th><th className="r">Gross</th><th className="r">Bond</th>{!isBeryl && <th className="r">Tax</th>}<th className="r">Net</th><th /></tr>
          </thead>
          <tbody>
            {crew.map((c, i) => (
              <tr key={i}>
                <td><input value={c.crew_name || ''} onChange={e => setCrewRow(i, { crew_name: e.target.value })} /></td>
                <td className="r"><input className="num" value={c.gross ?? ''} onChange={e => setCrewRow(i, { gross: e.target.value })} /></td>
                <td className="r"><input className="num" value={c.bond ?? ''} onChange={e => setCrewRow(i, { bond: e.target.value })} /></td>
                {!isBeryl && <td className="r"><input className="num" value={c.tax ?? ''} onChange={e => setCrewRow(i, { tax: e.target.value })} /></td>}
                <td className="r"><input className="num" value={c.net ?? ''} onChange={e => setCrewRow(i, { net: e.target.value })} /></td>
                <td className="x" title="Remove" onClick={() => setCrew(cs => cs.filter((_, x) => x !== i))}>×</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td>{crew.length} crew</td><td className="r num">{gbp2(fromLines.wages)}</td><td colSpan={isBeryl ? 3 : 4} /></tr>
          </tfoot>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        {mismatches.length > 0 && (
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
            <span>
              I have checked the {mismatches.length === 1 ? 'difference' : `${mismatches.length} differences`} above against the sheet.
              <span className="muted"> The figures saved will be the ones the lines add up to.</span>
            </span>
          </label>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={save} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save settlement'}</button>
          <button className="secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
