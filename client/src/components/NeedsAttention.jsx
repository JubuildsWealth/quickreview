import { useEffect, useState } from 'react'
import { Flame, Phone, Check, MessageSquare, Send, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'

// Quick-reply chips — one tap fills the textarea. Owner can edit or send as-is.
const QUICK_REPLIES = [
  'On our way — see you soon.',
  'Can I call you now?',
  'What time works best for you?',
  'Thanks — sending an estimate shortly.',
]

export default function NeedsAttention({ onDataChanged }) {
  const [hotLeads, setHotLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [handlingId, setHandlingId] = useState(null)

  // Text back state — only one card is open at a time to keep the UI calm
  const [replyingId, setReplyingId] = useState(null)
  const [replyBody, setReplyBody] = useState('')
  const [sendingReply, setSendingReply] = useState(false)

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

    const interval = setInterval(() => {
      loadHotLeads()
    }, 5000)

    return () => {
      clearInterval(interval)
    }
  }, [])

  const openReply = (leadId) => {
    setReplyingId(leadId)
    setReplyBody('')
  }

  const closeReply = () => {
    setReplyingId(null)
    setReplyBody('')
  }

  const sendReply = async (leadId) => {
    const trimmed = replyBody.trim()
    if (!trimmed) {
      toast.error('Write a message first')
      return
    }

    setSendingReply(true)
    try {
      await api.post(`/opportunities/hot-leads/${leadId}/reply`, {
        body: trimmed,
      })
      toast.success('Reply sent')
      closeReply()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send reply')
    } finally {
      setSendingReply(false)
    }
  }

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

      // If the handled lead was the one open for reply, close it
      if (replyingId === id) closeReply()

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
        {hotLeads.map((lead) => {
          const isReplying = replyingId === lead.id
          const charCount = replyBody.length
          const overSingleSegment = charCount > 160

          return (
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
                    
                  
  href={`tel:${lead.customer_phone}`}
  ...
                      className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                      Call
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => (isReplying ? closeReply() : openReply(lead.id))}
                    className={`inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      isReplying
                        ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    {isReplying ? 'Close' : 'Text back'}
                  </button>

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

              {/* ---------- Inline Text Back panel ---------- */}
              {isReplying && (
                <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  {/* Quick-reply chips */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {QUICK_REPLIES.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setReplyBody(chip)}
                        className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  {/* Textarea */}
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder="Type your reply…"
                    rows={2}
                    autoFocus
                    className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none bg-white"
                  />

                  {/* Footer: char counter + actions */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-xs">
                      <span
                        className={
                          overSingleSegment ? 'text-amber-600' : 'text-gray-400'
                        }
                      >
                        {charCount} / 160
                      </span>
                      {overSingleSegment && (
                        <span className="text-amber-600 ml-2">
                          · Will send as multiple messages
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={closeReply}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>

                      <button
                        type="button"
                        onClick={() => sendReply(lead.id)}
                        disabled={sendingReply || !replyBody.trim()}
                        className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Send className="w-4 h-4" />
                        {sendingReply ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 mt-3">
                    Sends from your Arova number to {lead.customer_phone || 'this customer'}.
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
