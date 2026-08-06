import Stat from '../Stat'
import { money2 } from '../lib/su/metrics'

const fmtDate = d => {
  if (!d) return '—'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.slice(8, 10)} ${M[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
}

export default function InvoicesTab({ invoices = [], onOpenFile }) {
  const unpaid = invoices.filter(i => i.status !== 'paid')
  const total = invoices.reduce((a, i) => a + Number(i.total || 0), 0)
  const outstanding = unpaid.reduce((a, i) => a + Number(i.total || 0), 0)

  return (
    <>
      <div className="statgrid">
        <Stat label={`Outstanding (${unpaid.length})`} value={money2(outstanding)} accent={outstanding > 0} />
        <Stat label={`All invoices (${invoices.length})`} value={money2(total)} />
      </div>

      {invoices.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No invoices for this boat.</p></div>
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Supplier</th><th>Description</th>
                <th className="r">Net</th><th className="r">VAT</th><th className="r">Total</th>
                <th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {invoices.map(i => (
                <tr key={i.id}>
                  <td className="num">{fmtDate(i.invoice_date)}</td>
                  <td className="strong">
                    {i.supplier}
                    {i.invoice_no && <span className="g"> · {i.invoice_no}</span>}
                  </td>
                  <td className="muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{i.description || '—'}</td>
                  <td className="r num">{money2(i.net)}</td>
                  <td className="r num">{money2(i.vat)}</td>
                  <td className="r num strong">{money2(i.total)}</td>
                  <td>
                    <span className={'flag ' + (i.status === 'paid' ? 'ok' : 'warn')}>
                      {i.status === 'paid' ? `Paid ${fmtDate(i.paid_date)}` : 'Unpaid'}
                    </span>
                  </td>
                  <td>
                    {i.file_path && (
                      <button className="secondary" style={{ padding: '0.2rem 0.55rem', fontSize: '0.76rem' }}
                        onClick={() => onOpenFile(i.file_path)}>View</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
