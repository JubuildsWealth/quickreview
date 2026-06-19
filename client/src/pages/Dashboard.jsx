import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Send, Users, TrendingUp, Clock, Plus } from 'lucide-react'

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <div className={`w-9 h-9 ${color} rounded-lg flex items-center justify-center`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value ?? '—'}</p>
    </div>
  )
}

export default function Dashboard({ business }) {
  const [stats, setStats] = useState(null)
  const [customerCount, setCustomerCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchParams] = useSearchParams()

  useEffect(() => {
    if (searchParams.get('subscribed') === 'true') {
      toast.success('Subscription active! Welcome to QuickReview.')
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [statsRes, custRes] = await Promise.all([
          api.get('/sms/stats'),
          api.get('/customers'),
        ])
        setStats(statsRes.data.stats)
        setCustomerCount(custRes.data.customers.length)
      } catch (err) {
        toast.error('Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">
          Welcome back, <span className="font-medium text-gray-700">{business.name}</span>
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-2/3 mb-4" />
              <div className="h-8 bg-gray-200 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Total requests sent"
            value={stats?.total_sent}
            icon={Send}
            color="bg-blue-500"
          />
          <StatCard
            label="Sent this month"
            value={stats?.sent_this_month}
            icon={TrendingUp}
            color="bg-green-500"
          />
          <StatCard
            label="Total customers"
            value={customerCount}
            icon={Users}
            color="bg-purple-500"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Quick actions</h2>
          <Link
            to="/customers"
            className="flex items-center gap-3 p-4 border border-blue-100 rounded-lg hover:bg-blue-50 transition-colors group"
          >
            <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
              <Plus className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">Add a customer & send review request</p>
              <p className="text-sm text-gray-500">Takes 10 seconds per customer</p>
            </div>
          </Link>
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Recent requests</h2>
          {!stats?.recent_requests?.length ? (
            <div className="text-center py-6 text-gray-400">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No requests sent yet.</p>
              <p className="text-xs mt-1">Head to Customers to get started.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {stats.recent_requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Send className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-gray-600 capitalize">{r.status}</span>
                  </div>
                  <span className="text-gray-400">
                    {new Date(r.sent_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Google review link nudge */}
      {!business.google_review_link && (
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-xl p-5">
          <p className="font-medium text-yellow-800">Add your Google Review link</p>
          <p className="text-sm text-yellow-700 mt-1">
            Your SMS messages are being sent without a direct Google Review link. Add it in settings to improve conversion.
          </p>
        </div>
      )}
    </div>
  )
}
