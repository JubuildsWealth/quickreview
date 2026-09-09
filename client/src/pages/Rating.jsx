import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Star, ExternalLink } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || ''

export default function Rating() {
  const { businessId } = useParams()
  const [searchParams] = useSearchParams()
  const customerId = searchParams.get('c')

  const [business, setBusiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState(0)
  const [selected, setSelected] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [comment, setComment] = useState('')
  const [googleLink, setGoogleLink] = useState(null)

  useEffect(() => {
    fetch(`${API}/api/rating/${businessId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.business) setBusiness(data.business)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [businessId])

  const submitRating = async (score) => {
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/api/rating/${businessId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: score,
          comment: comment || undefined,
          customer_id: customerId || undefined,
        }),
      })
      const data = await res.json()
      if (data.google_review_link) {
        setGoogleLink(data.google_review_link)
      }
      setSubmitted(true)
    } catch (e) {
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  const handleStarClick = (score) => {
    if (selected) return
    setSelected(score)
  }

  const handleSubmit = () => {
    if (!selected || submitting) return
    submitRating(selected)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-white">
        <p className="text-gray-400 text-sm">We could not find this business.</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-white">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-gray-100 flex items-center justify-center mx-auto mb-5">
            <Star className="w-5 h-5 text-brand-700" />
          </div>

          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            Thanks for your feedback
          </h1>

          <p className="text-sm text-gray-500 mb-6">
            Your experience helps {business.name} and others in the community.
          </p>

          {googleLink && (
            
              href={googleLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full bg-brand-600 text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors mb-3"
            >
              <ExternalLink className="w-4 h-4" />
              Share your experience on Google
            </a>
          )}

          <p className="text-xs text-gray-400">
            Sharing on Google helps local businesses grow.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-white">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-md w-full text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">{business.name}</h1>
        <p className="text-sm text-gray-500 mb-8">How was your experience?</p>

        <div className="flex justify-center gap-2 mb-8">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onMouseEnter={() => !selected && setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => handleStarClick(n)}
              disabled={!!selected}
              className="transition-transform hover:scale-110 disabled:cursor-default"
            >
              <Star
                className="w-9 h-9"
                fill={(hover || selected) >= n ? '#facc15' : 'none'}
                stroke={(hover || selected) >= n ? '#facc15' : '#d1d5db'}
              />
            </button>
          ))}
        </div>

        {selected > 0 && (
          <div className="space-y-4">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder={selected >= 4 ? 'Want to add anything? (optional)' : 'What could we have done better? (optional)'}
              className="w-full border border-gray-200 rounded-xl p-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition resize-none"
            />
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-brand-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
