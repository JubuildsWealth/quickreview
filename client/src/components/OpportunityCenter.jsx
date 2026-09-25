import { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  ClipboardList,
  FileText,
  PhoneMissed,
  Users,
  Send,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

function formatMoney(cents) {
  if (cents == null) return null
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function timeAgo(dateStr) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return `${months} mo ago`
}

const CATEGORIES = [
  {
    key: 'estimates',
    label: 'Open estimates',
    icon: ClipboardList,
    hasDollarValue: true,
  },
  {
    key: 'invoices',
    label: 'Unpaid invoices',
    icon: FileText,
    hasDollarValue: true,
  },
  {
    key: 'missed_calls',
    label: 'Unresolved missed calls',
    icon: PhoneMissed,
    hasDollarValue: false,
  },
  {
    key: 'reactivation',
    label: 'Reactivation candidates',
    icon: Users,
    hasDollarValue: false,
  },
]

/**
 * Four expandable category rows. Summary tile data comes from the parent
 * (via the /dashboard/summary call the parent already makes). Item lists
 * are fetched lazily on expand from /opportunities?type=X so we don't
 * waste bandwidth on categories the user doesn't open.
 */
export default function OpportunityCenter({ summary, loading, onDataChanged }) {
  const [expandedKey, setExpandedKey] = useState(null)
  const [items, setItems] = useState({})
  const [itemsLoading, setItemsLoading] = useState({})
  const [busyId, setBusyId] = useState(null)

  const toggle = async (key) => {
    if (expandedKey === key) {
      setExpandedKey(null)
      return
    }
    setExpandedKey(key)
    if (items[key]) return // already loaded
    await fetchType(key)
  }

  const fetchType = async (key) => {
    setItemsLoading((s) => ({ ...s, [key]: true }))
    try {
      const { data } = await api.get(`/opportunities?type=${key}`)
      setItems((s) => ({ ...s, [key]: data.opportunities || [] }))
    } catch (e) {
      toast.error('Could not load opportunities')
    } finally {
      setItemsLoading((s) => ({ ...s, [key]: false }))
    }
  }

  const refreshType = async (key) => {
    await fetchType(key)
    if (onDataChanged) onDataChanged()
  }

  const remindEstimate = async (id) => {
    setBusyId(id)
    try {
      await api.post(`/estimates/${id}/remind`)
      toast.success('Reminder sent')
      refreshType('estimates')
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not send reminder')
    } finally {
      setBusyId(null)
    }
  }

  const remindInvoice = async (id) => {
    setBusyId(id)
    try {
      await api.post(`/invoices/${id}/remind`)
      toast.success('Reminder sent')
      refreshType('invoices')
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not send reminder')
    } finally {
      setBusyId(null)
    }
  }

  const markMissedCallOutcome = async (id, outcome) => {
    setBusyId(id)
    try {
      await api.post('/opportunities/mark-missed-call-outcome', {
        missed_call_id: id,
        outcome,
      })
      toast.success(`Marked ${outcome}`)
      refreshType('missed_calls')
    } catch (e) {
      toast.error('Could not update')
    } finally {
      setBusyId(null)
    }
  }

  const reactivateBatch = async () => {
    setBusyId('reactivation-batch')
    try {
      const { data } = await api.post('/opportunities/reactivate-batch', { count: 5 })
      if (data.sent === 0) {
        toast(data.message || 'No eligible customers right now', { icon: 'ℹ️' })
      } else {
        toast.success(
          `Reactivation sent to ${data.sent} customer${data.sent === 1 ? '' : 's'}`
        )
      }
      refreshType('reactivation')
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not run reactivation')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 animate-pulse">
        <div className="h-5 bg-gray-100 rounded w-1/4 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
      <h2 className="font-semibold text-gray-900 mb-1">Opportunity Center</h2>
      <p className="text-sm text-gray-500 mb-4">
        Everything Arova can still recover for you
      </p>

      <div className="space-y-2">
        {CATEGORIES.map(({ key, label, icon: Icon, hasDollarValue }) => {
          const data = summary?.opportunities?.[key] || { count: 0, open_cents: 0 }
          const isExpanded = expandedKey === key
          const isEmpty = data.count === 0

          return (
            <div
              key={key}
              className={`border rounded-xl overflow-hidden ${
                isExpanded ? 'border-gray-300' : 'border-gray-200'
              }`}
            >
              <button
                onClick={() => toggle(key)}
                disabled={isEmpty}
                className={`w-full flex items-center gap-3 p-4 text-left transition-colors ${
                  isEmpty ? 'opacity-60 cursor-default' : 'hover:bg-gray-50'
                }`}
              >
                <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-brand-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900">{label}</p>
                  <p className="text-sm text-gray-500">
                    {data.count === 0
                      ? 'None right now'
                      : hasDollarValue
                      ? `${data.count} · ${formatMoney(data.open_cents)}`
                      : `${data.count} waiting`}
                  </p>
                </div>
                {!isEmpty &&
                  (isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  ))}
              </button>

              {isExpanded && !isEmpty && (
                <div className="border-t border-gray-100 bg-gray-50 p-3">
                  {key === 'reactivation' && (
                    <div className="mb-3 flex items-center justify-between px-2 gap-2 flex-wrap">
                      <p className="text-xs text-gray-500">
                        Sends the reactivation SMS to 5 oldest-eligible customers at once.
                      </p>
                      <button
                        onClick={reactivateBatch}
                        disabled={busyId === 'reactivation-batch'}
                        className="text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded-full px-3 py-1.5 shrink-0"
                      >
                        {busyId === 'reactivation-batch'
                          ? 'Sending…'
                          : 'Reactivate 5 oldest'}
                      </button>
                    </div>
                  )}

                  {itemsLoading[key] ? (
                    <div className="text-sm text-gray-400 text-center py-6">
                      Loading…
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {(items[key] || []).slice(0, 10).map((item) => (
                        <OpportunityRow
                          key={item.id}
                          item={item}
                          type={key}
                          busyId={busyId}
                          onRemindEstimate={remindEstimate}
                          onRemindInvoice={remindInvoice}
                          onMarkOutcome={markMissedCallOutcome}
                        />
                      ))}
                      {(items[key] || []).length > 10 && (
                        <li className="text-xs text-gray-400 text-center py-2">
                          Showing top 10 of {items[key].length}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OpportunityRow({
  item,
  type,
  busyId,
  onRemindEstimate,
  onRemindInvoice,
  onMarkOutcome,
}) {
  const isBusy = busyId === item.id
  const money = formatMoney(item.amount_cents)

  return (
    <li className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {item.customer_name || item.customer_phone || 'Unknown caller'}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {item.description ? `${item.description} · ` : ''}
          {type === 'reactivation' && item.last_serviced_at
            ? `last serviced ${timeAgo(item.last_serviced_at)}`
            : ''}
          {type !== 'reactivation' && item.created_at ? timeAgo(item.created_at) : ''}
          {item.reminder_count > 0 ? ` · reminded ${item.reminder_count}×` : ''}
        </p>
      </div>

      {money && (
        <div className="text-sm font-semibold text-gray-900 shrink-0">{money}</div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {type === 'estimates' && (
          <button
            onClick={() => onRemindEstimate(item.id)}
            disabled={isBusy || !item.can_remind}
            title={
              !item.can_remind
                ? 'Customer needs SMS consent + phone number to be reminded'
                : ''
            }
            className="text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40 rounded-full px-3 py-1.5 border border-gray-200 flex items-center gap-1"
          >
            <Send className="w-3 h-3" /> Remind
          </button>
        )}

        {type === 'invoices' && (
          <button
            onClick={() => onRemindInvoice(item.id)}
            disabled={isBusy || !item.can_remind}
            title={
              !item.can_remind
                ? 'Customer needs SMS consent + phone number to be reminded'
                : ''
            }
            className="text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40 rounded-full px-3 py-1.5 border border-gray-200 flex items-center gap-1"
          >
            <Send className="w-3 h-3" /> Remind
          </button>
        )}

        {type === 'missed_calls' && (
          <>
            <button
              onClick={() => onMarkOutcome(item.id, 'booked')}
              disabled={isBusy}
              className="text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-40 rounded-full px-3 py-1.5 border border-gray-200"
            >
              Booked
            </button>
            <button
              onClick={() => onMarkOutcome(item.id, 'dead')}
              disabled={isBusy}
              className="text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-40 rounded-full px-3 py-1.5 border border-gray-200"
            >
              Dead
            </button>
          </>
        )}
      </div>
    </li>
  )
}
