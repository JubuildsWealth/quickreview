import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Flame, FileText, Receipt, ArrowRight, Sparkles } from 'lucide-react'
import api from '../lib/api'

function formatMoney(cents) {
  if (!cents && cents !== 0) return '—'
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function AttentionRow({ icon: Icon, iconBg, iconColor, label, count, amount, to }) {
  if (!count) return null

  return (
    <Link
      to={to}
      className="flex items-center gap-4 px-5 py-4 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors group"
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900">
          {count} {label}
        </p>
        {amount !== null && (
          <p className="text-xs text-gray-500 mt-0.5">
            {formatMoney(amount)} at risk
          </p>
        )}
      </div>

      <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 shrink-0" />
    </Link>
  )
}

function HandledLine({ count, label }) {
  if (!count) return null
  return (
    <li className="text-sm text-gray-600 flex items-baseline gap-2">
      <span className="text-gray-300">·</span>
      <span>{count} {label}</span>
    </li>
  )
}

function TodaySkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 mb-6 animate-pulse">
      <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
      <div className="h-12 bg-gray-100 rounded w-2/3 mb-6" />
      <div className="space-y-3">
        <div className="h-16 bg-gray-100 rounded-xl" />
        <div className="h-16 bg-gray-100 rounded-xl" />
      </div>
    </div>
  )
}

export default function ArovaToday() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/dashboard/today')
        setData(res.data)
      } catch (err) {
        // Silent fail — empty state handles it below.
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <TodaySkeleton />
  if (!data) return null

  const { business_name, attention, handled_today } = data

  const nothingNeedsAttention =
    attention.total_cents === 0 &&
    attention.hot_leads_count === 0 &&
    attention.cold_estimates_count === 0 &&
    attention.overdue_invoices_count === 0

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 mb-6">
      {/* -------- Header -------- */}
      <div className="mb-6">
        <p className="text-sm font-medium text-gray-500">
          {getGreeting()}, {business_name}
        </p>

        {nothingNeedsAttention ? (
          <p className="text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900 leading-tight mt-2">
            Nothing needs your attention right now.
          </p>
        ) : (
          <div className="flex items-baseline gap-3 flex-wrap mt-2">
            <span className="text-4xl sm:text-5xl font-semibold tracking-tight text-gray-900 leading-none">
              {formatMoney(attention.total_cents)}
            </span>
            <span className="text-sm text-gray-500">
              needs your attention today
            </span>
          </div>
        )}
      </div>

      {/* -------- Attention items -------- */}
      {!nothingNeedsAttention && (
        <div className="space-y-2.5 mb-6">
          <AttentionRow
            icon={Flame}
            iconBg="bg-orange-50"
            iconColor="text-orange-600"
            label={attention.hot_leads_count === 1 ? 'hot lead waiting' : 'hot leads waiting'}
            count={attention.hot_leads_count}
            amount={null}
            to="/dashboard"
          />
          <AttentionRow
            icon={FileText}
            iconBg="bg-red-50"
            iconColor="text-red-600"
            label={attention.cold_estimates_count === 1 ? 'estimate going cold' : 'estimates going cold'}
            count={attention.cold_estimates_count}
            amount={attention.cold_estimates_cents}
            to="/estimates"
          />
          <AttentionRow
            icon={Receipt}
            iconBg="bg-red-50"
            iconColor="text-red-600"
            label={attention.overdue_invoices_count === 1 ? 'overdue invoice' : 'overdue invoices'}
            count={attention.overdue_invoices_count}
            amount={attention.overdue_invoices_cents}
            to="/invoices"
          />
        </div>
      )}

      {/* -------- Arova handled today -------- */}
      {handled_today.total_actions > 0 && (
        <div className={`${nothingNeedsAttention ? '' : 'pt-6 border-t border-gray-100'}`}>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">
              Arova handled {handled_today.total_actions}{' '}
              {handled_today.total_actions === 1 ? 'thing' : 'things'} today
            </p>
          </div>
          <ul className="space-y-1.5">
            <HandledLine
              count={handled_today.invoice_reminders}
              label={handled_today.invoice_reminders === 1 ? 'invoice reminder sent' : 'invoice reminders sent'}
            />
            <HandledLine
              count={handled_today.estimate_followups}
              label={handled_today.estimate_followups === 1 ? 'estimate follow-up sent' : 'estimate follow-ups sent'}
            />
            <HandledLine
              count={handled_today.customer_reactivations}
              label={handled_today.customer_reactivations === 1 ? 'customer reactivation sent' : 'customer reactivations sent'}
            />
            <HandledLine
              count={handled_today.missed_call_replies}
              label={handled_today.missed_call_replies === 1 ? 'missed call auto-reply sent' : 'missed call auto-replies sent'}
            />
            <HandledLine
              count={handled_today.review_followups}
              label={handled_today.review_followups === 1 ? 'review follow-up sent' : 'review follow-ups sent'}
            />
          </ul>
        </div>
      )}
    </div>
  )
}
