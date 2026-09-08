import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Send, Users, TrendingUp, Clock, Plus } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100">
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
          <Icon className="w-4 h-4 text-brand-600" />
        </div>
      </div>
      <p className="text-4xl font-semibold tracking-tight text-gray-900">{value ?? '—'}</p>
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
      toast.success('Subscription active! Welcome to Arova.')
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
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1.5">
          Welcome back, <span className="font-medium text-gray-900">{business.name}</span>
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-6 border border-gray-100 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-2/3 mb-5" />
              <div className="h-9 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard label="Total requests sent" value={stats?.total_sent} icon={Send} />
          <StatCard label="Sent this month" value={stats?.sent_this_month} icon={TrendingUp} />
          <StatCard label="Total customers" value={customerCount} icon={Users} />
        </div>
      )}

      {/* Review requests growth chart */}
      {stats?.weekly && stats.weekly.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-8">
          <h2 className="font-semibold text-gray-900 mb-1">Review requests over time</h2>
          <p className="text-sm text-gray-500 mb-6">Last 8 weeks</p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={stats.weekly} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#86868b' }} axisLine={{ stroke: '#e5e5e5' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#86868b' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e5e5', fontSize: 13 }} />
              <Line
                type="monotone"
                dataKey="requests"
                               stroke="#1d1d1f"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#1d1d1f' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick actions */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Quick actions</h2>
          <Link
            to="/customers"
            className="flex items-center gap-3 p-4 border border-gray-100 rounded-xl hover:border-brand-200 hover:bg-brand-50 transition-colors group"
          >
            <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center group-hover:bg-brand-100 transition-colors">
              <Plus className="w-4 h-4 text-brand-600" />
            </div>
            <div>
              <p className="font-medium text-gray-900">Add a customer & send review request</p>
              <p className="text-sm text-gray-500">Takes 10 seconds per customer</p>
            </div>
          </Link>
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
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
        <div className="mt-6 bg-brand-50 border border-brand-100 rounded-2xl p-5">
          <p className="font-medium text-gray-900">Add your Google Review link</p>
          <p className="text-sm text-gray-600 mt-1">
            Your messages are going out without a direct Google Review link. Add it in settings to improve conversion.
          </p>
        </div>
      )}
    </div>
  )
}
