import { useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Star, Building2 } from 'lucide-react'

export default function Onboarding({ onComplete }) {
  const [name, setName] = useState('')
  const [googleReviewLink, setGoogleReviewLink] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { data } = await api.post('/business', { name, google_review_link: googleReviewLink })
      toast.success('Business profile created!')
      onComplete(data.business)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-10 h-10 mx-auto mb-5 rounded-xl border border-gray-200 flex items-center justify-center">
            <Building2 className="w-4.5 h-4.5 text-brand-700" />
          </div>

          <p className="text-sm font-semibold tracking-[-0.02em] text-gray-900 mb-4">
            Arova
          </p>

          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-gray-900">
            Set up your business
          </h1>

          <p className="text-sm text-gray-500 mt-2">
            This takes 30 seconds — just two fields.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-7 sm:px-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Business name <span className="text-red-500">*</span>
              </label>

              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-11 border border-gray-200 rounded-xl px-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                placeholder="e.g. Johnson Plumbing & HVAC"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Google Review link
              </label>

              <input
                type="url"
                value={googleReviewLink}
                onChange={(e) => setGoogleReviewLink(e.target.value)}
                className="w-full h-11 border border-gray-200 rounded-xl px-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                placeholder="https://g.page/r/YOUR_REVIEW_ID/review"
              />

              <p className="text-xs leading-5 text-gray-400 mt-2">
                Find yours: Google Maps → your business → Share → Copy link. You can add this later.
              </p>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-brand-600 text-white rounded-xl text-sm font-semibold tracking-[-0.01em] hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving…' : 'Continue to billing'}
              </button>
            </div>
          </form>
        </div>

        <p className="text-xs font-medium tracking-[-0.01em] text-gray-400 text-center mt-5">
          Built to help you get more customers.
        </p>
      </div>
    </div>
  )
}
