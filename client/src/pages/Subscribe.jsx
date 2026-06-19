import { useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Check, Star, CreditCard } from 'lucide-react'

const features = [
  'Unlimited SMS review requests',
  'Customer contact management',
  'Review request tracking & analytics',
  'Personalized messages with your business name',
  'Works with any Google Business profile',
]

export default function Subscribe({ business }) {
  const [loading, setLoading] = useState(false)

  const handleSubscribe = async () => {
    setLoading(true)
    try {
      const { data } = await api.post('/stripe/checkout')
      window.location.href = data.url
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not start checkout')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-yellow-100 rounded-2xl mb-4">
            <Star className="w-7 h-7 text-yellow-500 fill-current" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Start getting reviews</h1>
          <p className="text-gray-500 mt-1 text-sm">
            One simple plan. Cancel any time.
          </p>
        </div>

        <div className="border-2 border-blue-500 rounded-xl p-6 mb-6">
          <div className="flex items-end gap-1 mb-1">
            <span className="text-4xl font-bold text-gray-900">$97</span>
            <span className="text-gray-500 mb-1">/month</span>
          </div>
          <p className="text-sm text-gray-500 mb-5">QuickReview Pro</p>

          <ul className="space-y-3">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={handleSubscribe}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <CreditCard className="w-4 h-4" />
          {loading ? 'Redirecting to checkout…' : 'Subscribe now — $97/month'}
        </button>

        <p className="text-xs text-gray-400 text-center mt-3">
          Powered by Stripe. Your card is charged $97 monthly. Cancel any time from your billing portal.
        </p>
      </div>
    </div>
  )
}
