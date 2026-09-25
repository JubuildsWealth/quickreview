import { TrendingUp, Flame } from 'lucide-react'

function formatMoney(cents) {
  if (!cents && cents !== 0) return '—'
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

/**
 * The visual anchor of the dashboard. Shows the pipeline value Arova is
 * actively working, plus attributed recovery this month, plus hot-leads
 * count (hot leads land Day 3 — will be 0 until then).
 */
export default function RevenueRecoveryHero({ summary, loading }) {
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
    <div className="bg-white rounded-2xl border border-gray-200 p-8 mb-6">
      <p className="text-sm font-medium text-gray-500 mb-2">Open opportunities</p>
      <div className="flex items-baseline gap-4 mb-6 flex-wrap">
        <span className="text-5xl font-semibold tracking-tight text-gray-900 leading-none">
          {formatMoney(openTotal)}
        </span>
        <span className="text-sm text-gray-500">
          {hasOpportunities
            ? 'in pipeline Arova is working'
            : 'nothing open right now'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl">
          <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4 text-green-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Recovered this month</p>
            <p className="text-lg font-semibold text-gray-900">{formatMoney(recovered)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              hotLeads > 0 ? 'bg-orange-50' : 'bg-gray-50'
            }`}
          >
            <Flame
              className={`w-4 h-4 ${hotLeads > 0 ? 'text-orange-600' : 'text-gray-400'}`}
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-500">Hot leads waiting</p>
            <p className="text-lg font-semibold text-gray-900">{hotLeads}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
