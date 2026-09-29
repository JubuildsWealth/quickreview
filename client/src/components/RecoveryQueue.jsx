import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Banknote,
  FileText,
  Receipt,
  Send,
  Sparkles,
  AlertCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../lib/api'

function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100)
}

function PriorityBadge({ priority }) {
  if (priority === 'high') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        High priority
      </span>
    )
  }

  if (priority === 'medium') {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
        Needs attention
      </span>
    )
  }

  return null
}

/**
 * Deterministic rules for when an item needs human attention
 * vs when Arova can keep handling it automatically.
 *
 * Returns true if the item needs the owner's decision.
 */
function needsHuman(item) {
  const days = item.days_since_activity || 0
  const nudges = item.reminder_count || 0
  const amount = item.amount_cents || 0

  // Rule 1: Aging and Arova hasn't touched it yet.
  if (nudges === 0 && days >= 3) return true

  // Rule 2: Arova has tried multiple times, nothing's working.
  if (nudges >= 2 && days >= 7) return true

  // Rule 3: High-value, high-priority items always surface.
  if (item.priority === 'high' && amount >= 100000) return true

  return false
}
function getNextBestAction(item) {
  const days = item.days_since_activity || 0
  const nudges = item.reminder_count || 0
  const amount = item.amount_cents || 0

  // Arova has already tried repeatedly. Human intervention is next.
  if (nudges >= 2 && days >= 7) {
    return 'Call today'
  }

  // High-value opportunities deserve direct human attention.
  if (item.priority === 'high' && amount >= 100000) {
    return 'Call today'
  }

  // Aging opportunity that has not been contacted yet.
  if (nudges === 0 && days >= 3) {
    return 'Send nudge'
  }

  // Recently contacted. Give the customer time to respond.
  if (nudges > 0 && days < 3) {
    return 'Wait for reply'
  }

  // New opportunities do not need immediate intervention.
  return 'Monitor'
}
function QueueSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 mb-6 overflow-hidden">
      <div className="p-6 border-b border-gray-100">
        <div className="h-4 w-32 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="h-8 w-44 bg-gray-100 rounded animate-pulse" />
      </div>

      <div className="divide-y divide-gray-100">
        {[1, 2].map((item) => (
          <div
            key={item}
            className="p-5 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-4 flex-1">
              <div className="w-10 h-10 rounded-xl bg-gray-100 animate-pulse shrink-0" />

              <div className="flex-1">
                <div className="h-4 w-40 bg-gray-100 rounded animate-pulse mb-2" />
                <div className="h-3 w-56 bg-gray-100 rounded animate-pulse" />
              </div>
            </div>

            <div className="h-9 w-24 bg-gray-100 rounded-xl animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

function QueueItem({ item, isSending, sendingId, onFollowUp }) {
  const Icon = item.type === 'estimate' ? FileText : Receipt

  return (
    <div className="px-6 py-5">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex items-start gap-3.5 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-gray-500" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="font-medium text-gray-900 truncate">
                {item.customer_name}
              </p>

              <span className="text-gray-300">·</span>

              <span className="text-sm text-gray-500 capitalize">
                {item.type}
              </span>
            </div>

            {item.description && (
              <p className="text-sm text-gray-600 mt-1 truncate">
                {item.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <PriorityBadge priority={item.priority} />

              <span className="text-xs text-gray-500">
                {item.reason}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between lg:justify-end gap-4 lg:pl-4">
          <div className="lg:text-right shrink-0">
            <p className="text-lg font-semibold tracking-tight text-gray-900">
              {formatMoney(item.amount_cents)}
            </p>

            <p className="text-xs text-gray-400 mt-0.5">
              {item.reminder_count || 0}{' '}
              {(item.reminder_count || 0) === 1
                ? 'follow-up'
                : 'follow-ups'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onFollowUp(item)}
            disabled={isSending || !!sendingId}
            className="inline-flex items-center justify-center gap-2 min-w-[118px] px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />

            {isSending ? 'Sending...' : item.action_label}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RecoveryQueue({ onDataChanged }) {
  const [queue, setQueue] = useState([])
  const [totalAtRisk, setTotalAtRisk] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const [highPriorityCount, setHighPriorityCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sendingId, setSendingId] = useState(null)

  const loadQueue = async () => {
    try {
      const res = await api.get('/recovery/queue')

      setQueue(res.data.queue || [])
      setTotalAtRisk(res.data.total_at_risk_cents || 0)
      setTotalItems(res.data.total_items || 0)
      setHighPriorityCount(res.data.high_priority_count || 0)
    } catch (err) {
      console.error('Failed to load recovery queue:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadQueue()
  }, [])

  const handleFollowUp = async (item) => {
    if (sendingId) return

    setSendingId(`${item.type}-${item.id}`)

    try {
      if (item.type === 'estimate') {
        await api.post(`/estimates/${item.id}/remind`)
      } else {
        await api.post(`/invoices/${item.id}/remind`)
      }

      toast.success(
        item.type === 'estimate'
          ? 'Estimate follow-up sent.'
          : 'Invoice reminder sent.'
      )

      await loadQueue()

      if (onDataChanged) {
        await onDataChanged()
      }
    } catch (err) {
      const message =
        err.response?.data?.error ||
        'Could not send follow-up. Please try again.'

      toast.error(message)
    } finally {
      setSendingId(null)
    }
  }

  if (loading) {
    return <QueueSkeleton />
  }

  const visibleQueue = queue.slice(0, 5)

  // Split the queue into two buckets using deterministic rules.
  const needsYou = visibleQueue.filter(needsHuman)
  const arovaHandling = visibleQueue.filter((item) => !needsHuman(item))

  return (
    <div className="bg-white rounded-2xl border border-gray-200 mb-6 overflow-hidden">
      <div className="p-6 border-b border-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
                <Banknote className="w-4 h-4 text-gray-600" />
              </div>

              <h2 className="font-semibold text-gray-900">
                Recovery Queue
              </h2>

              {totalItems > 0 && (
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-gray-900 text-white text-[11px] font-semibold">
                  {totalItems}
                </span>
              )}
            </div>

            <p className="text-sm text-gray-500">
              Highest-value opportunities that may need your attention.
            </p>
          </div>

          {totalItems > 0 && (
            <div className="sm:text-right shrink-0">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Money at risk
              </p>

              <p className="text-2xl font-semibold tracking-tight text-gray-900 mt-0.5">
                {formatMoney(totalAtRisk)}
              </p>

              {highPriorityCount > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  {highPriorityCount}{' '}
                  {highPriorityCount === 1
                    ? 'high-priority opportunity'
                    : 'high-priority opportunities'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {visibleQueue.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
            <Banknote className="w-5 h-5 text-gray-400" />
          </div>

          <p className="text-sm font-medium text-gray-900">
            Nothing waiting to be recovered
          </p>

          <p className="text-sm text-gray-500 mt-1">
            Open estimates and unpaid invoices will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Needs You section */}
          {needsYou.length > 0 && (
            <div>
              <div className="px-6 py-3 bg-amber-50/60 border-b border-amber-100 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Needs you
                </p>
                <span className="text-xs text-amber-700">
                  · {needsYou.length}{' '}
                  {needsYou.length === 1 ? 'item' : 'items'} require your decision
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {needsYou.map((item) => (
                  <QueueItem
                    key={`${item.type}-${item.id}`}
                    item={item}
                    isSending={sendingId === `${item.type}-${item.id}`}
                    sendingId={sendingId}
                    onFollowUp={handleFollowUp}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Arova Handling section */}
          {arovaHandling.length > 0 && (
            <div>
              <div className="px-6 py-3 bg-gray-50/60 border-b border-gray-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-gray-500" />
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Arova is handling
                </p>
                <span className="text-xs text-gray-500">
                  · Auto-nudging {arovaHandling.length}{' '}
                  {arovaHandling.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {arovaHandling.map((item) => (
                  <QueueItem
                    key={`${item.type}-${item.id}`}
                    item={item}
                    isSending={sendingId === `${item.type}-${item.id}`}
                    sendingId={sendingId}
                    onFollowUp={handleFollowUp}
                  />
                ))}
              </div>
            </div>
          )}

          {queue.length > 5 && (
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-gray-500">
                  Showing 5 of {queue.length} opportunities
                </p>

                <div className="flex items-center gap-4">
                  <Link
                    to="/estimates"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900"
                  >
                    Estimates
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>

                  <Link
                    to="/invoices"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900"
                  >
                    Invoices
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
