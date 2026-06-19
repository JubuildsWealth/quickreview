import { useEffect, useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Plus, Send, Trash2, Phone, User, Clock, CheckCircle } from 'lucide-react'

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
      const { data } = await api.post('/customers', { name, phone })
      setCustomers((prev) => [{ ...data.customer, review_requests: [] }, ...prev])
      setName('')
      setPhone('')
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
      // Refresh to update the sent status
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
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500 mt-1">Add customers and send Google review requests via SMS</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add customer
        </button>
      </div>

      {/* Add customer form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">New customer</h2>
          <form onSubmit={handleAddCustomer} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Phone number</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {submitting ? 'Adding…' : 'Add customer'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-gray-200 rounded-full" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-gray-200 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <User className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-500">No customers yet</p>
          <p className="text-sm text-gray-400 mt-1">Click "Add customer" to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {customers.map((customer) => {
            const last = lastSent(customer)
            const sent = !!last
            return (
              <div
                key={customer.id}
                className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-blue-600 font-semibold text-sm">
                      {customer.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{customer.name}</p>
                    <p className="text-sm text-gray-500">{formatPhone(customer.phone)}</p>
                    {sent && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        <span className="text-xs text-gray-400">
                          Request sent {new Date(last.sent_at).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleSendSMS(customer)}
                    disabled={sendingId === customer.id}
                    className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    title="Send review request via SMS"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sendingId === customer.id ? 'Sending…' : sent ? 'Send again' : 'Send request'}
                  </button>
                  <button
                    onClick={() => handleDelete(customer)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
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
