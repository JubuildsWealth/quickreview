import { useEffect, useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Plus, Send, Check, X, DollarSign } from 'lucide-react'

function formatMoney(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function timeAgo(dateStr) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function statusLabel(status) {
  if (status === 'sent') return 'Open'
  if (status === 'accepted') return 'Accepted'
  if (status === 'declined') return 'Declined'
  if (status === 'expired') return 'Expired'
  return status
}

function statusColor(status) {
  if (status === 'accepted') return '#1d8a4e'
  if (status === 'declined') return '#c00'
  if (status === 'expired') return '#86868b'
  return '#1d1d1f'
}

export default function Estimates({ business }) {
  const [estimates, setEstimates] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [busyId, setBusyId] = useState(null)

  const [wonPromptFor, setWonPromptFor] = useState(null)
  const [wonRevenue, setWonRevenue] = useState('')

  const load = async () => {
    try {
      const [est, cust] = await Promise.all([
        api.get('/estimates'),
        api.get('/customers'),
      ])
      setEstimates(est.data.estimates || [])
      setCustomers(cust.data.customers || [])
    } catch (e) {
      toast.error('Could not load estimates')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const createEstimate = async () => {
    if (!customerId) return toast.error('Pick a customer')
        const dollars = parseFloat(String(amount).replace(/,/g, ''))
    if (!dollars || dollars <= 0) return toast.error('Enter a valid amount')

    setSubmitting(true)
    try {
      await api.post('/estimates', {
        customer_id: customerId,
        amount_cents: Math.round(dollars * 100),
        description: description || undefined,
      })
      toast.success('Estimate added')
      setCustomerId(''); setAmount(''); setDescription('')
      setShowForm(false)
      load()
    } catch (e) {
      toast.error('Could not add estimate')
    } finally {
      setSubmitting(false)
    }
  }

  const markAccepted = async (id) => {
    setBusyId(id)
    try {
      await api.patch(`/estimates/${id}`, { status: 'accepted' })
      toast.success('Marked accepted')
      load()
    } catch (e) {
      toast.error('Could not update')
    } finally {
      setBusyId(null)
    }
  }

  const markDeclined = async (id) => {
    setBusyId(id)
    try {
      await api.patch(`/estimates/${id}`, { status: 'declined' })
      toast.success('Marked declined')
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
      await api.post(`/estimates/${id}/remind`)
      toast.success('Reminder sent')
      load()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not send reminder')
    } finally {
      setBusyId(null)
    }
  }

  const submitWon = async () => {
    if (!wonPromptFor) return
        const dollars = parseFloat(String(wonRevenue).replace(/,/g, ''))
    if (!dollars || dollars <= 0) return toast.error('Enter the revenue amount')

    setBusyId(wonPromptFor.id)
    try {
      await api.patch(`/estimates/${wonPromptFor.id}`, {
        won: true,
        revenue_cents: Math.round(dollars * 100),
      })
      toast.success('Recorded as won')
      setWonPromptFor(null)
      setWonRevenue('')
      load()
    } catch (e) {
      toast.error('Could not record win')
    } finally {
      setBusyId(null)
    }
  }

  const open = estimates.filter((e) => e.status === 'sent')
  const openTotal = open.reduce((sum, e) => sum + e.amount_cents, 0)
  const wonThisMonth = estimates
    .filter((e) => e.won_at && new Date(e.won_at).getMonth() === new Date().getMonth())
    .reduce((sum, e) => sum + (e.attributed_revenue_cents || 0), 0)

  const s = {
    page: { fontFamily: "'Inter', -apple-system, sans-serif", color: '#1d1d1f', maxWidth: 860, margin: '0 auto', padding: '32px 24px' },
    tile: { flex: 1, background: '#f5f5f7', borderRadius: 12, padding: 16 },
    tileLabel: { fontSize: 13, color: '#86868b', marginBottom: 6 },
    tileNum: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' },
    pillDark: { background: '#1d1d1f', color: '#fff', fontSize: 14, fontWeight: 500, padding: '9px 16px', borderRadius: 980, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
    pillOutline: { background: '#fff', color: '#1d1d1f', border: '1px solid #d2d2d7', borderRadius: 980, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 },
    pillGray: { background: '#f5f5f7', color: '#1d1d1f', border: 'none', borderRadius: 980, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
    pillGreen: { background: '#1d8a4e', color: '#fff', border: 'none', borderRadius: 980, padding: '7px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 },
    input: { width: '100%', boxSizing: 'border-box', background: '#f5f5f7', border: 'none', borderRadius: 10, padding: '11px 14px', fontSize: 15, fontFamily: "'Inter', sans-serif", marginBottom: 10, outline: 'none' },
  }

  if (loading) return <div style={{ ...s.page, textAlign: 'center', color: '#86868b' }}>Loading…</div>

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>Estimates</div>
          <div style={{ fontSize: 14, color: '#86868b' }}>Track open quotes and recover the ones sitting on the fence</div>
        </div>
        <button style={s.pillDark} onClick={() => setShowForm(!showForm)}>
          {showForm ? <X size={15} /> : <Plus size={15} />}
          {showForm ? 'Close' : 'New estimate'}
        </button>
      </div>

      {showForm && (
        <div style={{ background: '#fff', border: '1px solid #e8e8ed', borderRadius: 14, padding: 20, marginBottom: 24 }}>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={s.input}>
            <option value="">Select a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Estimate amount (e.g. 2400)" inputMode="decimal" style={s.input} />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the job? (e.g. Water heater replacement)" style={s.input} />
          <button style={{ ...s.pillDark, width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={createEstimate} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add estimate'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={s.tile}><div style={s.tileLabel}>Open value</div><div style={s.tileNum}>{formatMoney(openTotal)}</div></div>
        <div style={s.tile}><div style={s.tileLabel}>Open estimates</div><div style={s.tileNum}>{open.length}</div></div>
        <div style={s.tile}><div style={s.tileLabel}>Won this month</div><div style={s.tileNum}>{formatMoney(wonThisMonth)}</div></div>
      </div>

      {estimates.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#86868b', padding: '48px 0', fontSize: 15 }}>
          No estimates yet. Add the ones you have out to start recovering revenue automatically.
        </div>
      ) : (
        <div style={{ border: '1px solid #e8e8ed', borderRadius: 12, overflow: 'hidden' }}>
          {estimates.map((est) => {
            const isOpen = est.status === 'sent'
            const isWon = !!est.won_at
            const cust = est.customers || {}
            const remindedLabel = est.reminder_count > 0 ? `reminded ${est.reminder_count}×` : 'not reminded'
            return (
              <div key={est.id} style={{ display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #f0f0f2', opacity: (!isOpen && !isWon) ? 0.55 : 1 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 3 }}>{cust.name || 'Customer'}</div>
                  {est.description && <div style={{ fontSize: 14, color: '#1d1d1f', marginBottom: 2 }}>{est.description}</div>}
                  <div style={{ fontSize: 13, color: '#86868b' }}>
                    {isOpen
                      ? `${timeAgo(est.sent_at)} · ${remindedLabel}`
                      : (
                          <span style={{ color: statusColor(est.status) }}>
                            {statusLabel(est.status)}
                            {isWon && est.attributed_revenue_cents
                              ? ` · won ${formatMoney(est.attributed_revenue_cents)}`
                              : ''}
                          </span>
                        )}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginRight: 20 }}>{formatMoney(est.amount_cents)}</div>
                {isOpen ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button style={s.pillOutline} onClick={() => sendReminder(est.id)} disabled={busyId === est.id}>
                      <Send size={13} /> Remind
                    </button>
                    <button style={s.pillGray} onClick={() => markAccepted(est.id)} disabled={busyId === est.id}>
                      Accepted
                    </button>
                    <button style={s.pillGray} onClick={() => markDeclined(est.id)} disabled={busyId === est.id}>
                      Declined
                    </button>
                    <button
                      style={s.pillGreen}
                      onClick={() => { setWonPromptFor(est); setWonRevenue(((est.amount_cents || 0) / 100).toString()) }}
                      disabled={busyId === est.id}
                    >
                      <DollarSign size={13} /> Mark won
                    </button>
                  </div>
                ) : est.status === 'accepted' && !isWon ? (
                  <button
                    style={s.pillGreen}
                    onClick={() => { setWonPromptFor(est); setWonRevenue(((est.amount_cents || 0) / 100).toString()) }}
                    disabled={busyId === est.id}
                  >
                    <DollarSign size={13} /> Mark won
                  </button>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 500, color: statusColor(est.status) }}>
                    {isWon ? <><Check size={15} style={{ verticalAlign: 'middle' }} /> Won</> : statusLabel(est.status)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {wonPromptFor && (
        <div
          onClick={() => { setWonPromptFor(null); setWonRevenue('') }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 24, width: 'min(420px, 90vw)' }}>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Record win</div>
            <div style={{ fontSize: 14, color: '#86868b', marginBottom: 16 }}>
              How much did the job come out to? This gets attributed to Arova only if we actually followed up before you won it.
            </div>
            <input
              value={wonRevenue}
              onChange={(e) => setWonRevenue(e.target.value)}
              placeholder="Revenue (e.g. 2400)"
              inputMode="decimal"
              style={s.input}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button style={s.pillGray} onClick={() => { setWonPromptFor(null); setWonRevenue('') }}>Cancel</button>
              <button style={s.pillGreen} onClick={submitWon} disabled={busyId === wonPromptFor.id}>
                Record win
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
