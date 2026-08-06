import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext'
import SectionRule from './SectionRule'
import FormatSampleTerms, { CONSENT_VERSION } from './FormatSampleTerms'

// Shown to a skipper whose settling sheet is not yet readable, in place of an
// empty Settlements page. They can send a sheet in so the reader can be built
// around it — or ignore it entirely, which is a fair answer.
//
// The tick is the consent. It is recorded with a timestamp and the wording
// version, and withdrawal deletes both the file and the row, or it would not
// be consent at all.

export default function FormatSampleUpload() {
  const { appUser } = useAuth()
  const [mine, setMine] = useState([])
  const [showTerms, setShowTerms] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [file, setFile] = useState(null)
  const [agent, setAgent] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('su_format_samples')
      .select('id, agent, note, status, created_at, file_path')
      .order('created_at', { ascending: false })
    setMine(data || [])
  }
  useEffect(() => { load() }, [])

  async function send(e) {
    e.preventDefault()
    if (!file || !agreed) return
    setBusy(true)
    setError('')
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${appUser.fleet_id}/${Date.now()}_${safe}`
      const { error: upErr } = await supabase.storage.from('su-format-samples').upload(path, file)
      if (upErr) throw upErr

      const { error: rowErr } = await supabase.from('su_format_samples').insert({
        fleet_id: appUser.fleet_id,
        uploaded_by: appUser.id,
        uploader_email: appUser.email || null,
        agent: agent.trim() || null,
        note: note.trim() || null,
        file_path: path,
        consent_version: CONSENT_VERSION,
      })
      if (rowErr) throw rowErr

      setDone(true)
      setFile(null); setAgent(''); setNote(''); setAgreed(false)
      load()
    } catch (e) {
      setError(e.message || String(e))
    }
    setBusy(false)
  }

  // Withdrawal has to remove the file as well as the record.
  async function withdraw(row) {
    if (!confirm('Withdraw this sheet? The file and the record of it are both deleted.')) return
    setError('')
    const { error: sErr } = await supabase.storage.from('su-format-samples').remove([row.file_path])
    if (sErr) { setError(`Could not remove the file: ${sErr.message}`); return }
    const { error: rErr } = await supabase.from('su_format_samples').delete().eq('id', row.id)
    if (rErr) { setError(rErr.message); return }
    load()
  }

  const STATUS = {
    pending: ['warn', 'Waiting'],
    in_progress: ['warn', 'Being built'],
    supported: ['ok', 'Supported'],
    withdrawn: ['bad', 'Withdrawn'],
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Settling sheets are not read for your boat yet</h2>
        <p>
          The reader has been taught two layouts so far. Yours is not one of them — so
          rather than read it wrongly, it does not try.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          If you send one in, it can be built around your sheet. Or leave it: every other
          part of Skipper Management works without this, and settlement figures can always
          be entered by hand.
        </p>
      </div>

      {done && (
        <div className="card" style={{ borderLeft: '3px solid var(--kelp)' }}>
          <p style={{ margin: 0 }}>
            <strong>Sent.</strong> It will be looked at and your format built in. You can
            withdraw it below at any point before then.
          </p>
        </div>
      )}

      <SectionRule side="optional">Send a settling sheet</SectionRule>

      <form className="card" onSubmit={send}>
        {error && <p className="error">{error}</p>}

        <div className="fgrid fgrid-3" style={{ marginBottom: 14 }}>
          <label>
            <span className="fl">Who issues the sheet</span>
            <input value={agent} onChange={e => setAgent(e.target.value)} placeholder="e.g. Don, LHD, Scrabster" />
          </label>
          <label style={{ gridColumn: 'span 2' }}>
            <span className="fl">Anything worth knowing</span>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. crew names blacked out" />
          </label>
        </div>

        <label className="fl">The sheet (PDF or a photo)</label>
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={e => setFile(e.target.files?.[0] || null)}
          style={{ marginBottom: 14 }}
        />

        <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ width: 'auto', marginTop: 3 }} />
          <span>
            I understand David Gatt <strong>may see</strong> this sheet, including any crew
            wages on it, in order to build the reader for my format. It will not be shared
            with anyone else and will be deleted once my format is supported.{' '}
            <button
              type="button"
              className="secondary"
              onClick={() => setShowTerms(s => !s)}
              style={{ padding: '1px 8px', fontSize: '0.78rem', marginLeft: 4 }}
            >
              {showTerms ? 'Hide detail' : 'What happens to it'}
            </button>
          </span>
        </label>

        {showTerms && <div style={{ margin: '4px 0 14px' }}><FormatSampleTerms /></div>}

        <p className="note" style={{ margin: '0 0 12px' }}>
          You can black out crew names first if you would rather — the reader is built
          around where the figures sit, not who is on the sheet.
        </p>

        <button type="submit" disabled={!file || !agreed || busy}>
          {busy ? 'Sending…' : 'Send this sheet'}
        </button>
      </form>

      {mine.length > 0 && (
        <>
          <SectionRule side="yours">Sheets you have sent</SectionRule>
          <div className="tw">
            <table>
              <thead><tr><th>Sent</th><th>Agent</th><th>Note</th><th>Status</th><th /></tr></thead>
              <tbody>
                {mine.map(r => {
                  const [tone, label] = STATUS[r.status] || ['warn', r.status]
                  return (
                    <tr key={r.id}>
                      <td className="num">{(r.created_at || '').slice(0, 10)}</td>
                      <td className="strong">{r.agent || '—'}</td>
                      <td className="muted">{r.note || '—'}</td>
                      <td><span className={'flag ' + tone}>{label}</span></td>
                      <td><button className="secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => withdraw(r)}>Withdraw</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="note">Withdrawing deletes the file and the record of it, straight away.</p>
        </>
      )}
    </>
  )
}
