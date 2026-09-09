import { useEffect, useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Plus, Send, Trash2, Phone, User } from 'lucide-react'

function formatPhone(phone) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

export default function Customers({ business }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sendingId, setSendingId] = useState(null)

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

  useEffect(() => { loadCustomers() }, [])

  const handleAddCustomer = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { data } = await api.post('/customers', { name, phone, sms_consent: smsConsent })
      setCustomers((prev) => [{ ...data.customer, review_requests: [] }, ...prev])
      setName('')
      setPhone('')
      setSmsConsent(false)
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

  const lastSent = (customer) => {
    const reqs = customer.review_requests || []
    if (!reqs.length) return null
    return reqs.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at))[0]
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Customers
          </h1>
          <p className="text-sm text-gray-500 mt-1.5">
            Add customers and send Google review requests via SMS.
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

      {/* Add customer form */}
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

      {/* Customer list */}
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
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
                    <span className="text-brand-700 font-semibold text-sm">
                      {customer.name.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {customer.name}
                    </p>

                    <p className="text-sm text-gray-500 mt-0.5">
                      {formatPhone(customer.phone)}
                    </p>

                    <div className="mt-2">
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
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:shrink-0">
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
