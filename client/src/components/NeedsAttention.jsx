import { useEffect, useState } from 'react'
import { Flame, Phone, Check, MessageSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { supabase } from '../lib/supabase'
export default function NeedsAttention({ onDataChanged }) {
  const [hotLeads, setHotLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [handlingId, setHandlingId] = useState(null)

  const loadHotLeads = async () => {
    try {
      const { data } = await api.get('/opportunities/hot-leads')
      setHotLeads(data.hot_leads || [])
    } catch (err) {
      console.error('Failed to load hot leads:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
  loadHotLeads()

  const channel = supabase
    .channel('dashboard-hot-leads')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'sms_replies',
      },
      () => {
       () => {
  console.log('🔥 HOT LEAD REALTIME EVENT RECEIVED')
  loadHotLeads()

        if (onDataChanged) {
          onDataChanged()
        }
      }
    )
    .subscribe((status) => {
  console.log('🔥 HOT LEAD REALTIME STATUS:', status)
})

  return () => {
    supabase.removeChannel(channel)
  }
}, [])

  const markHandled = async (id) => {
    setHandlingId(id)

    try {
      await api.post(`/opportunities/hot-leads/${id}/handled`)

      setHotLeads((current) =>
        current.filter((lead) => lead.id !== id)
      )
if (onDataChanged) {
  await onDataChanged()
}
      toast.success('Lead marked as handled')
    } catch (err) {
      toast.error(
        err.response?.data?.error || 'Failed to mark lead as handled'
      )
    } finally {
      setHandlingId(null)
    }
  }

  const formatTime = (date) => {
    if (!date) return ''

    const parsed = new Date(date)
    const diffMs = Date.now() - parsed.getTime()
    const diffMinutes = Math.floor(diffMs / 60000)

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`

    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`

    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`

    return parsed.toLocaleDateString()
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 animate-pulse">
        <div className="h-5 bg-gray-100 rounded w-40 mb-3" />
        <div className="h-4 bg-gray-100 rounded w-64" />
      </div>
    )
  }

  if (hotLeads.length === 0) {
    return null
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 mb-6 overflow-hidden">
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                <Flame className="w-4 h-4 text-orange-600" />
              </div>

              <h2 className="font-semibold text-gray-900">
                Needs attention
              </h2>

              <span className="inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full bg-gray-900 text-white text-xs font-semibold">
                {hotLeads.length}
              </span>
            </div>

            <p className="text-sm text-gray-500 mt-2">
              Customers who replied with buying intent
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {hotLeads.map((lead) => (
          <div key={lead.id} className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="w-4 h-4 text-gray-400 shrink-0" />

                  <p className="font-medium text-gray-900 truncate">
                    {lead.customer_name || lead.customer_phone || 'Customer'}
                  </p>

                  <span className="text-xs text-gray-400 shrink-0">
                    {formatTime(lead.received_at)}
                  </span>
                </div>

                <p className="text-sm text-gray-700">
                  “{lead.body}”
                </p>

                {lead.customer_phone && (
                  <p className="text-xs text-gray-400 mt-2">
                    {lead.customer_phone}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {lead.customer_phone && (
                  <a
                    href={`tel:${lead.customer_phone}`}
                    className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    Call
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => markHandled(lead.id)}
                  disabled={handlingId === lead.id}
                  className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  {handlingId === lead.id ? 'Saving...' : 'Mark handled'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
