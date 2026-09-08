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
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-10 h-10 mx-auto mb-5 rounded-xl border border-gray-200 flex items-center justify-center">
            <span className="text-base font-semibold tracking-[-0.03em] text-brand-700">
              A
            </span>
          </div>

          <p className="text-sm font-semibold tracking-[-0.02em] text-gray-900 mb-4">
            Arova
          </p>

          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-gray-950">
            Start getting reviews
          </h1>

          <p className="text-sm text-gray-500 mt-2">
            One simple plan. Cancel any time.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-7 sm:px-7">
          <div className="pb-6 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">
              Arova
            </p>

            <div className="flex items-end gap-1.5 mt-3">
              <span className="text-4xl font-semibold tracking-[-0.045em] text-gray-950">
                $97
              </span>
              <span className="text-sm text-gray-500 mb-1">
                /month
              </span>
            </div>
          </div>

          <ul className="space-y-4 py-6">
            {features.map((f) => (
              <li
                key={f}
                className="flex items-start gap-3 text-sm leading-5 text-gray-700"
              >
                <div className="w-5 h-5 rounded-md bg-brand-50 flex items-center justify-center shrink-0">
                  <Check className="w-3.5 h-3.5 text-brand-700" />
                </div>

                <span>{f}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full h-11 bg-brand-600 text-white rounded-xl text-sm font-semibold tracking-[-0.01em] hover:bg-brand-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            <CreditCard className="w-4 h-4" />
            {loading ? 'Redirecting to checkout…' : 'Subscribe now — $97/month'}
          </button>

          <p className="text-xs leading-5 text-gray-400 text-center mt-4">
            Powered by Stripe. Your card is charged $97 monthly. Cancel any time from your billing portal.
          </p>
        </div>

        <p className="text-xs font-medium tracking-[-0.01em] text-gray-400 text-center mt-5">
          Built to help you get more customers.
        </p>
      </div>
    </div>
  )
}
