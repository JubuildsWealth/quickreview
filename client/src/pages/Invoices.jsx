import { useEffect, useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Plus, Send, Check, X } from 'lucide-react'

function formatMoney(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function timeAgo(dateStr) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

export default function Invoices({ business }) {
  const [invoices, setInvoices] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    try {
      const [inv, cust] = await Promise.all([
        api.get('/invoices'),
        api.get('/customers'),
      ])
           setInvoices(inv.data.invoices || [])
      setCustomers(cust.data.customers || [])
    } catch (e) {
      toast.error('Could not load invoices')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const createInvoice = async () => {
    if (!customerId) return toast.error('Pick a customer')
    const dollars = parseFloat(amount)
    if (!dollars || dollars <= 0) return toast.error('Enter a valid amount')

    setSubmitting(true)
    try {
      await api.post('/invoices', {
        customer_id: customerId,
        amount_cents: Math.round(dollars * 100),
        description: description || undefined,
        payment_note: paymentNote || undefined,
      })
      toast.success('Invoice added')
      setCustomerId(''); setAmount(''); setDescription(''); setPaymentNote('')
      setShowForm(false)
      load()
    } catch (e) {
      toast.error('Could not add invoice')
    } finally {
      setSubmitting(false)
    }
  }

  const markPaid = async (id) => {
    setBusyId(id)
    try {
      await api.patch(`/invoices/${id}/paid`)
      toast.success('Marked paid')
      load()
    } catch (e) {
      toast.error('Could not update')
    } finally {
      setBusyId(null)
    }
  }

  const sendReminder = async (id) => {
    setBusyId(id)
    try {
      await api.post(`/invoices/${id}/remind`)
      toast.success('Reminder sent')
      load()
    } catch (e) {
      toast.error(e?.message || 'Could not send reminder')
    } finally {
      setBusyId(null)
    }
  }

  const unpaid = invoices.filter((i) => i.status === 'unpaid')
  const outstanding = unpaid.reduce((sum, i) => sum + i.amount_cents, 0)
  const paidThisMonth = invoices
    .filter((i) => i.status === 'paid' && i.paid_at && new Date(i.paid_at).getMonth() === new Date().getMonth())
    .reduce((sum, i) => sum + i.amount_cents, 0)

  const s = {
    page: { fontFamily: "'Inter', -apple-system, sans-serif", color: '#1d1d1f', maxWidth: 860, margin: '0 auto', padding: '32px 24px' },
    tile: { flex: 1, background: '#f5f5f7', borderRadius: 12, padding: 16 },
    tileLabel: { fontSize: 13, color: '#86868b', marginBottom: 6 },
    tileNum: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' },
    pillDark: { background: '#1d1d1f', color: '#fff', fontSize: 14, fontWeight: 500, padding: '9px 16px', borderRadius: 980, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
    pillOutline: { background: '#fff', color: '#1d1d1f', border: '1px solid #d2d2d7', borderRadius: 980, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 },
    pillGray: { background: '#f5f5f7', color: '#1d1d1f', border: 'none', borderRadius: 980, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
    input: { width: '100%', boxSizing: 'border-box', background: '#f5f5f7', border: 'none', borderRadius: 10, padding: '11px 14px', fontSize: 15, fontFamily: "'Inter', sans-serif", marginBottom: 10, outline: 'none' },
  }

  if (loading) return <div style={{ ...s.page, textAlign: 'center', color: '#86868b' }}>Loading…</div>

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>Invoices</div>
          <div style={{ fontSize: 14, color: '#86868b' }}>Track who owes you and send reminders</div>
        </div>
        <button style={s.pillDark} onClick={() => setShowForm(!showForm)}>
          {showForm ? <X size={15} /> : <Plus size={15} />}
          {showForm ? 'Close' : 'New invoice'}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#fff', border: '1px solid #e8e8ed', borderRadius: 14, padding: 20, marginBottom: 24 }}>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={s.input}>
            <option value="">Select a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (e.g. 850)" inputMode="decimal" style={s.input} />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was the job? (e.g. Water heater install)" style={s.input} />
          <input value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="How to pay (e.g. Venmo @joeys-plumbing)" style={s.input} />
          <button style={{ ...s.pillDark, width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={createInvoice} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add invoice'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={s.tile}><div style={s.tileLabel}>Outstanding</div><div style={s.tileNum}>{formatMoney(outstanding)}</div></div>
        <div style={s.tile}><div style={s.tileLabel}>Unpaid</div><div style={s.tileNum}>{unpaid.length}</div></div>
        <div style={s.tile}><div style={s.tileLabel}>Paid this month</div><div style={s.tileNum}>{formatMoney(paidThisMonth)}</div></div>
      </div>

      {invoices.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#86868b', padding: '48px 0', fontSize: 15 }}>
          No invoices yet. Add one to start tracking who owes you.
        </div>
      ) : (
        <div style={{ border: '1px solid #e8e8ed', borderRadius: 12, overflow: 'hidden' }}>
          {invoices.map((inv) => {
            const paid = inv.status === 'paid'
            const cust = inv.customers || {}
            const remindedLabel = inv.reminder_count > 0 ? `reminded ${inv.reminder_count}×` : 'not reminded'
            return (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #f0f0f2', opacity: paid ? 0.55 : 1 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 3 }}>{cust.name || 'Customer'}</div>
                  {inv.description && <div style={{ fontSize: 14, color: '#1d1d1f', marginBottom: 2 }}>{inv.description}</div>}
                  <div style={{ fontSize: 13, color: '#86868b' }}>
                    {paid ? 'Paid' : `${timeAgo(inv.created_at)} · ${remindedLabel}`}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginRight: 20 }}>{formatMoney(inv.amount_cents)}</div>
                {paid ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 500, color: '#1d8a4e' }}>
                    <Check size={15} /> Paid
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={s.pillOutline} onClick={() => sendReminder(inv.id)} disabled={busyId === inv.id}>
                      <Send size={13} /> Remind
                    </button>
                    <button style={s.pillGray} onClick={() => markPaid(inv.id)} disabled={busyId === inv.id}>
                      Mark paid
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
