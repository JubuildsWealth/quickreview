import { useEffect, useState } from 'react'
import { TrendingUp, Flame, CheckCircle2 } from 'lucide-react'
import api from '../lib/api'

function formatMoney(cents) {
  if (!cents && cents !== 0) return '—'
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function formatRelativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const days = Math.floor(diffMs / 86400000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function RevenueRecoveryHero({ summary, loading }) {
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(true)

  useEffect(() => {
    const loadEvents = async () => {
      try {
        const res = await api.get('/recovery/events?limit=5')
        setEvents(res.data.events || [])
      } catch (err) {
        // Empty state is handled below, no toast noise
      } finally {
        setEventsLoading(false)
      }
    }
    loadEvents()
  }, [summary])

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-8 mb-6 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-1/3 mb-4" />
        <div className="h-12 bg-gray-100 rounded w-1/2 mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="h-16 bg-gray-100 rounded-xl" />
          <div className="h-16 bg-gray-100 rounded-xl" />
        </div>
      </div>
    )
  }

  const openTotal = summary?.open_total_cents || 0
  const recovered = summary?.recovered_this_month_cents || 0
  const hotLeads = summary?.hot_leads_open || 0
  const hasOpportunities = openTotal > 0

  return (
  <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 mb-6">
    {/* -------- Executive recovery snapshot -------- */}
    <div className="mb-6">
      <p className="text-sm font-medium text-gray-500 mb-5">
        Revenue recovery
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-0">
        {/* Recovered */}
        <div className="sm:pr-8">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
            Recovered this month
          </p>

          <div className="flex items-center gap-2">
            <span className="text-4xl sm:text-5xl font-semibold tracking-tight text-gray-900 leading-none">
              {formatMoney(recovered)}
            </span>

            {recovered > 0 && (
              <TrendingUp className="w-5 h-5 text-green-600 shrink-0" />
            )}
          </div>

          <p className="text-sm text-gray-500 mt-3">
            {recovered > 0
              ? 'Revenue recovered after Arova follow-up'
              : 'Your first Arova recovery will show here'}
          </p>
        </div>

        {/* Revenue at risk */}
        <div className="sm:pl-8 sm:border-l sm:border-gray-200">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
            Revenue at risk
          </p>

          <span className="text-4xl sm:text-5xl font-semibold tracking-tight text-gray-900 leading-none">
            {formatMoney(openTotal)}
          </span>

          <p className="text-sm text-gray-500 mt-3">
            {hasOpportunities
              ? 'Unresolved estimates and invoices'
              : 'No unresolved revenue opportunities'}
          </p>
        </div>
      </div>
    </div>

    {/* -------- Hot leads -------- */}
    <div className="pt-5 border-t border-gray-100">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              hotLeads > 0 ? 'bg-orange-50' : 'bg-gray-50'
            }`}
          >
            <Flame
              className={`w-4 h-4 ${
                hotLeads > 0 ? 'text-orange-600' : 'text-gray-400'
              }`}
            />
          </div>

          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              Hot leads waiting
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {hotLeads > 0
                ? 'Customers showing buying intent'
                : 'No buying-intent replies need attention'}
            </p>
          </div>
        </div>

        <span className="text-2xl font-semibold tracking-tight text-gray-900 shrink-0">
          {hotLeads}
        </span>
      </div>
    </div>

    {/* -------- Recent recoveries -------- */}
    {!eventsLoading && events.length > 0 && (
      <div className="mt-6 pt-6 border-t border-gray-100">
        <div className="flex items-center justify-between gap-4 mb-3">
          <p className="text-sm font-medium text-gray-700">
            Recent recoveries
          </p>
          <p className="text-xs text-gray-400">
            What Arova helped close
          </p>
        </div>

        <ul className="divide-y divide-gray-100">
          {events.map((e) => {
            const label =
              e.source_type === 'estimate'
                ? 'Estimate won'
                : 'Invoice paid'

            const followUpsLine =
              e.reminder_count_at_recovery > 0
                ? `after ${e.reminder_count_at_recovery} Arova follow-up${
                    e.reminder_count_at_recovery === 1 ? '' : 's'
                  }`
                : 'after Arova follow-up'

            return (
              <li
                key={e.id}
                className="py-3 flex items-center gap-3"
              >
                <div className="w-8 h-8 bg-green-50 rounded-lg flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {formatMoney(e.amount_cents)} · {label}
                  </p>

                  <p className="text-xs text-gray-500 truncate">
                    {e.customer_name}
                    {e.description ? ` · ${e.description}` : ''} ·{' '}
                    {followUpsLine}
                  </p>
                </div>

                <span className="text-xs text-gray-400 shrink-0">
                  {formatRelativeTime(e.recovered_at)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    )}
  </div>
)
