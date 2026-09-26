import { useEffect, useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import {
  Plus,
  Send,
  Trash2,
  Phone,
  User,
  History,
  ArrowLeft,
  MessageSquare,
  ReceiptText,
  FileText,
  CheckCircle2,
  DollarSign,
  Flame,
  RefreshCw,
} from 'lucide-react'

function formatPhone(phone) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

function formatMoney(cents) {
  if (cents === null || cents === undefined) return null

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

function formatActivityDate(date) {
  if (!date) return ''

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

function getActivityStyle(type) {
  switch (type) {
    case 'recovery':
      return {
        icon: DollarSign,
        iconClass: 'text-green-700',
        iconWrapClass: 'bg-green-50 border-green-100',
        titleClass: 'text-green-800',
      }

    case 'invoice_paid':
    case 'estimate_won':
      return {
        icon: CheckCircle2,
        iconClass: 'text-green-700',
        iconWrapClass: 'bg-green-50 border-green-100',
        titleClass: 'text-gray-900',
      }

    case 'invoice_created':
    case 'invoice_reminder':
      return {
        icon: ReceiptText,
        iconClass: 'text-gray-600',
        iconWrapClass: 'bg-gray-50 border-gray-200',
        titleClass: 'text-gray-900',
      }

    case 'estimate_created':
    case 'estimate_reminder':
      return {
        icon: FileText,
        iconClass: 'text-gray-600',
        iconWrapClass: 'bg-gray-50 border-gray-200',
        titleClass: 'text-gray-900',
      }

    case 'customer_reply':
    case 'business_reply':
    case 'review_request':
    case 'reactivation_message':
      return {
        icon: MessageSquare,
        iconClass: 'text-brand-700',
        iconWrapClass: 'bg-brand-50 border-brand-100',
        titleClass: 'text-gray-900',
      }

    case 'hot_lead':
    case 'hot_lead_detected':
      return {
        icon: Flame,
        iconClass: 'text-amber-700',
        iconWrapClass: 'bg-amber-50 border-amber-100',
        titleClass: 'text-gray-900',
      }

    case 'hot_lead_handled':
      return {
        icon: CheckCircle2,
        iconClass: 'text-gray-600',
        iconWrapClass: 'bg-gray-50 border-gray-200',
        titleClass: 'text-gray-900',
      }

    default:
      return {
        icon: History,
        iconClass: 'text-gray-500',
        iconWrapClass: 'bg-gray-50 border-gray-200',
        titleClass: 'text-gray-900',
      }
  }
}

function ActivityTimeline({ activity }) {
  if (!activity.length) {
    return (
      <div className="py-16 text-center">
        <div className="w-11 h-11 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto">
          <History className="w-5 h-5 text-gray-400" />
        </div>

        <h3 className="text-sm font-semibold text-gray-900 mt-4">
          No activity yet
        </h3>

        <p className="text-sm text-gray-500 mt-1">
          Arova activity for this customer will appear here.
        </p>
      </div>
    )
  }

  return (
    <div>
      {activity.map((event, index) => {
        const style = getActivityStyle(event.type)
        const Icon = style.icon
        const isRecovery = event.type === 'recovery'
        const amount = formatMoney(event.amount_cents)

        return (
          <div
            key={event.id || `${event.type}-${event.occurred_at}-${index}`}
            className="relative flex gap-4"
          >
            {index !== activity.length - 1 && (
              <div className="absolute left-[17px] top-10 bottom-0 w-px bg-gray-200" />
            )}

            <div
              className={`relative z-10 w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${style.iconWrapClass}`}
            >
              <Icon className={`w-4 h-4 ${style.iconClass}`} />
            </div>

            <div
              className={`flex-1 min-w-0 pb-6 ${
                index !== activity.length - 1
                  ? 'border-b border-gray-100 mb-6'
                  : ''
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className={`text-sm font-semibold ${style.titleClass}`}>
                      {event.title || 'Activity'}
                    </h3>

                    {isRecovery && amount && (
                      <span className="inline-flex items-center rounded-full bg-green-50 border border-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
                        {amount} recovered
                      </span>
                    )}
                  </div>

                  {event.description && (
                    <p className="text-sm text-gray-500 mt-1 leading-5">
                      {event.description}
                    </p>
                  )}

                  {!isRecovery && amount && (
                    <p className="text-sm font-medium text-gray-700 mt-1">
                      {amount}
                    </p>
                  )}
                </div>

                <p className="text-xs text-gray-400 shrink-0 sm:text-right">
                  {formatActivityDate(event.occurred_at)}
                </p>
              </div>

              {isRecovery && (
                <div className="mt-3 rounded-xl border border-green-100 bg-green-50/60 px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0" />

                    <p className="text-xs font-medium text-green-800">
                      Revenue recovered after Arova follow-up
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Customers({ business }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  const [spanish, setSpanish] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sendingId, setSendingId] = useState(null)

  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [activity, setActivity] = useState([])
  const [activityCount, setActivityCount] = useState(0)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityRefreshing, setActivityRefreshing] = useState(false)

  const loadCustomers = async () => {
    try {
      const { data } = await api.get('/customers')
      setCustomers(data.customers)
    } catch {
      toast.error('Failed to load customers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCustomers()
  }, [])

  const handleAddCustomer = async (e) => {
    e.preventDefault()

    if (!smsConsent) {
      toast.error('SMS consent is required before adding this customer.')
      return
    }

    setSubmitting(true)

    try {
      const { data } = await api.post('/customers', {
        name,
        phone,
        sms_consent: smsConsent,
        language: spanish ? 'es' : 'en',
      })

      setCustomers((prev) => [
        { ...data.customer, review_requests: [] },
        ...prev,
      ])

      setName('')
      setPhone('')
      setSmsConsent(false)
      setSpanish(false)
      setShowForm(false)

      toast.success(`${data.customer.name} added!`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add customer')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSendSMS = async (customer) => {
    setSendingId(customer.id)

    try {
      await api.post('/sms/send', { customer_id: customer.id })
      toast.success(`Review request sent to ${customer.name}!`)
      await loadCustomers()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send SMS')
    } finally {
      setSendingId(null)
    }
  }

  const handleDelete = async (customer) => {
    if (!confirm(`Remove ${customer.name}? This cannot be undone.`)) return

    try {
      await api.delete(`/customers/${customer.id}`)
      setCustomers((prev) => prev.filter((c) => c.id !== customer.id))
      toast.success('Customer removed')
    } catch {
      toast.error('Failed to remove customer')
    }
  }

  const loadActivity = async (customer, refreshing = false) => {
    if (refreshing) {
      setActivityRefreshing(true)
    } else {
      setActivityLoading(true)
      setActivity([])
      setActivityCount(0)
    }

    try {
      const { data } = await api.get(`/customers/${customer.id}/activity`)

      setSelectedCustomer(data.customer || customer)
      setActivity(data.activity || [])
      setActivityCount(data.count ?? data.activity?.length ?? 0)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load customer activity')

      if (!refreshing) {
        setSelectedCustomer(null)
      }
    } finally {
      setActivityLoading(false)
      setActivityRefreshing(false)
    }
  }

  const handleOpenActivity = async (customer) => {
    setSelectedCustomer(customer)
    await loadActivity(customer)
  }

  const handleCloseActivity = () => {
    setSelectedCustomer(null)
    setActivity([])
    setActivityCount(0)
  }

  const lastSent = (customer) => {
    const reqs = customer.review_requests || []

    if (!reqs.length) return null

    return [...reqs].sort(
      (a, b) => new Date(b.sent_at) - new Date(a.sent_at)
    )[0]
  }

  if (selectedCustomer) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <button
          onClick={handleCloseActivity}
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors mb-7"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to customers
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5 mb-8">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center shrink-0">
              <span className="text-brand-700 text-base font-semibold">
                {selectedCustomer.name?.charAt(0).toUpperCase()}
              </span>
            </div>

            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-1">
                Customer activity
              </p>

              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 truncate">
                {selectedCustomer.name}
              </h1>

              {selectedCustomer.phone && (
                <p className="text-sm text-gray-500 mt-1">
                  {formatPhone(selectedCustomer.phone)}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => loadActivity(selectedCustomer, true)}
            disabled={activityRefreshing}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                activityRefreshing ? 'animate-spin' : ''
              }`}
            />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              Activity
            </p>

            <p className="text-2xl font-semibold tracking-tight text-gray-900 mt-1">
              {activityLoading ? '—' : activityCount}
            </p>

            <p className="text-xs text-gray-500 mt-1">
              Recorded customer events
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
              Latest activity
            </p>

            <p className="text-sm font-semibold text-gray-900 mt-2">
              {activityLoading
                ? 'Loading…'
                : activity.length
                  ? activity[0].title
                  : 'No activity yet'}
            </p>

            <p className="text-xs text-gray-500 mt-1">
              {activityLoading
                ? 'Fetching customer history'
                : activity.length
                  ? formatActivityDate(activity[0].occurred_at)
                  : 'Nothing recorded yet'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-5 sm:px-6 py-5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-gray-500" />

              <h2 className="text-base font-semibold text-gray-900">
                Timeline
              </h2>
            </div>

            <p className="text-sm text-gray-500 mt-1">
              A read-only history of Arova activity for this customer.
            </p>
          </div>

          <div className="p-5 sm:p-6">
            {activityLoading ? (
              <div className="space-y-7">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="flex gap-4 animate-pulse">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 shrink-0" />

                    <div className="flex-1 pt-1">
                      <div className="h-3.5 bg-gray-100 rounded-lg w-1/3" />
                      <div className="h-3 bg-gray-100 rounded-lg w-2/3 mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ActivityTimeline activity={activity} />
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Customers
          </h1>

          <p className="text-sm text-gray-500 mt-1.5">
            Add customers, send review requests, and view their Arova activity.
          </p>
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add customer
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 mb-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-gray-900">
              New customer
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              Add their contact information to send a review request.
            </p>
          </div>

          <form onSubmit={handleAddCustomer}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Name
                </label>

                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Smith"
                    className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Phone number
                </label>

                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-start gap-3">
              <input
                type="checkbox"
                id="smsConsent"
                required
                checked={smsConsent}
                onChange={(e) => setSmsConsent(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />

              <label
                htmlFor="smsConsent"
                className="text-sm leading-5 text-gray-500"
              >
                Customer agreed to receive review request texts (SMS)
              </label>
            </div>

            <div className="mt-3 flex items-start gap-3">
              <input
                type="checkbox"
                id="spanish"
                checked={spanish}
                onChange={(e) => setSpanish(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />

              <label
                htmlFor="spanish"
                className="text-sm leading-5 text-gray-500"
              >
                Send this customer messages in Spanish
              </label>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6 pt-5 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={submitting}
                className="bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Adding…' : 'Add customer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-gray-100 rounded-full shrink-0" />

                <div className="flex-1">
                  <div className="h-4 bg-gray-100 rounded-lg w-1/3 mb-2" />
                  <div className="h-3 bg-gray-100 rounded-lg w-1/4" />
                </div>

                <div className="h-9 bg-gray-100 rounded-xl w-28 hidden sm:block" />
              </div>
            </div>
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-4">
            <User className="w-5 h-5 text-gray-400" />
          </div>

          <h2 className="text-base font-semibold text-gray-900">
            No customers yet
          </h2>

          <p className="text-sm text-gray-500 mt-1.5 max-w-sm mx-auto">
            Add your first customer to start sending Google review requests.
          </p>

          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors mt-5"
          >
            <Plus className="w-4 h-4" />
            Add customer
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {customers.map((customer) => {
            const last = lastSent(customer)
            const sent = !!last

            return (
              <div
                key={customer.id}
                className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <button
                  type="button"
                  onClick={() => handleOpenActivity(customer)}
                  className="flex items-center gap-4 min-w-0 text-left group"
                  title={`View ${customer.name}'s activity`}
                >
                  <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
                    <span className="text-brand-700 font-semibold text-sm">
                      {customer.name.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-brand-700 transition-colors">
                        {customer.name}
                      </p>

                      <History className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-500 transition-colors shrink-0" />
                    </div>

                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatPhone(customer.phone)}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {sent ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          Requested {new Date(last.sent_at).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                          Not requested
                        </span>
                      )}

                      {customer.language === 'es' && (
                        <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                          Español
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-2 sm:shrink-0">
                  <button
                    onClick={() => handleOpenActivity(customer)}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 border border-gray-200 bg-white text-gray-700 px-3.5 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                    title="View customer activity"
                  >
                    <History className="w-3.5 h-3.5" />
                    Activity
                  </button>

                  <button
                    onClick={() => handleSendSMS(customer)}
                    disabled={sendingId === customer.id}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 bg-brand-600 text-white px-3.5 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    title="Send review request via SMS"
                  >
                    <Send className="w-3.5 h-3.5" />

                    {sendingId === customer.id
                      ? 'Sending…'
                      : sent
                        ? 'Send again'
                        : 'Send request'}
                  </button>

                  <button
                    onClick={() => handleDelete(customer)}
                    className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                    title="Remove customer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
