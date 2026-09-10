import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Send, Users, TrendingUp, Plus, Zap, ArrowRight, Check, Link as LinkIcon } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <Icon className="w-4 h-4 text-gray-400" />
      </div>
      <p className="text-2xl font-semibold tracking-tight text-gray-900">{value ?? '—'}</p>
    </div>
  )
}

function ChecklistStep({ done, title, subtitle, to, cta }) {
  const content = (
    <div className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
      done ? 'border-gray-100 bg-gray-50' : 'border-gray-200 hover:border-brand-200 hover:bg-brand-50'
    }`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
        done ? 'bg-green-500' : 'border-2 border-gray-300'
      }`}>
        {done && <Check className="w-3.5 h-3.5 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
          {title}
        </p>
        {!done && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {!done && (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 shrink-0">
          {cta} <ArrowRight className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
  )
  return done ? content : <Link to={to}>{content}</Link>
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

  const totalSent = stats?.total_sent ?? 0
  const sentThisMonth = stats?.sent_this_month ?? 0
  const hasActivity = totalSent > 0
  const isNewUser = !loading && totalSent === 0

  const hasReviewLink = !!business.google_review_link
  const hasCustomer = (customerCount ?? 0) > 0
  const hasSent = totalSent > 0

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1.5">
          Welcome back, <span className="font-medium text-gray-900">{business.name}</span>
        </p>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-8 border border-gray-200 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-1/3 mb-4" />
            <div className="h-12 bg-gray-100 rounded w-1/4" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-5 border border-gray-200 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-2/3 mb-4" />
                <div className="h-7 bg-gray-100 rounded w-1/3" />
              </div>
            ))}
          </div>
        </div>
      ) : isNewUser ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Get started with Arova</h2>
            <p className="text-sm text-gray-500 mt-1.5">
              Three quick steps and you’ll be collecting reviews in a couple of minutes.
            </p>
          </div>
          <div className="space-y-3">
            <ChecklistStep
              done={hasReviewLink}
              title="Add your Google review link"
              subtitle="So customers can leave you a review in one tap"
              to="/settings"
              cta="Add link"
            />
            <ChecklistStep
              done={hasCustomer}
              title="Add your first customer"
              subtitle="Takes about 10 seconds"
              to="/customers"
              cta="Add customer"
            />
            <ChecklistStep
              done={hasSent}
              title="Send your first review request"
              subtitle="Arova texts them a link to leave a review"
              to="/customers"
              cta="Send request"
            />
          </div>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-gray-200 p-8 mb-6">
            <p className="text-sm font-medium text-gray-500">Review requests sent</p>
            <div className="flex items-end gap-4 mt-2">
              <span className="text-5xl font-semibold tracking-tight text-gray-900 leading-none">
                {totalSent}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700 mb-1">
                <TrendingUp className="w-3.5 h-3.5" />
                {sentThisMonth} this month
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-4 max-w-xl leading-relaxed">
              Every request is a chance for a happy customer to bring you more business.
              Arova handles the follow-up so you don’t have to.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <StatCard label="Total requests sent" value={totalSent} icon={Send} />
            <StatCard label="Sent this month" value={sentThisMonth} icon={TrendingUp} />
            <StatCard label="Total customers" value={customerCount} icon={Users} />
          </div>

          {stats?.weekly && stats.weekly.length > 0 && hasActivity && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
              <h2 className="font-semibold text-gray-900 mb-1">Your review requests are growing</h2>
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
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Quick actions</h2>
              <div className="space-y-3">
                <Link
                  to="/customers"
                  className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-brand-200 hover:bg-brand-50 transition-colors group"
                >
                  <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center group-hover:bg-brand-100 transition-colors shrink-0">
                    <Plus className="w-4 h-4 text-brand-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">Add a customer &amp; send a request</p>
                    <p className="text-sm text-gray-500">Takes about 10 seconds</p>
                  </div>
                </Link>
                <Link
                  to="/automations"
                  className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-brand-200 hover:bg-brand-50 transition-colors group"
                >
                  <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center group-hover:bg-brand-100 transition-colors shrink-0">
                    <Zap className="w-4 h-4 text-brand-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">Put your follow-ups on autopilot</p>
                    <p className="text-sm text-gray-500">Set up automations</p>
                  </div>
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Recent activity</h2>
              {!stats?.recent_requests?.length ? (
                <div className="text-center py-8 text-gray-400">
                  <Send className="w-7 h-7 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No requests sent yet.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {stats.recent_requests.map((r) => (
                    <li key={r.id} className="flex items-center justify-between text-sm py-1">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span className="text-gray-700">Review request sent</span>
                      </div>
                      <span className="text-gray-400 shrink-0">
                        {new Date(r.sent_at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <Link
            to="/automations"
            className="mt-6 flex items-center justify-between gap-4 bg-white rounded-2xl border border-gray-200 p-5 hover:border-brand-200 transition-colors group"
          >
            <div className="min-w-0">
              <p className="font-medium text-gray-900">Recover unpaid invoices automatically</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Turn on Invoice Recovery and let Arova chase the money that slips through the cracks.
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-brand-600 transition-colors shrink-0" />
          </Link>
        </>
      )}

      {!loading && !isNewUser && !business.google_review_link && (
        <div className="mt-6 bg-brand-50 border border-brand-100 rounded-2xl p-5">
          <p className="font-medium text-gray-900">Add your Google review link</p>
          <p className="text-sm text-gray-600 mt-1">
            Your messages are going out without a direct Google review link. Add it in Settings to
            improve conversion.
          </p>
        </div>
      )}
    </div>
  )
}
