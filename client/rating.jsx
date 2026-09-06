import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Star } from 'lucide-react'

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
  const [done, setDone] = useState(false)
  const [comment, setComment] = useState('')
  const [showComment, setShowComment] = useState(false)

  useEffect(() => {
    fetch(`${API}/api/rating/${businessId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.business) setBusiness(data.business)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [businessId])

  const submitRating = async (score, withComment) => {
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/api/rating/${businessId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: score,
          comment: withComment ? comment : undefined,
          customer_id: customerId || undefined,
        }),
      })
      const data = await res.json()
      if (data.route === 'google' && data.google_review_link) {
        window.location.href = data.google_review_link
      } else {
        setDone(true)
      }
    } catch (e) {
      setDone(true)
    } finally {
      setSubmitting(false)
    }
  }

  const handleStarClick = (score) => {
    setSelected(score)
    if (score >= 4) {
      submitRating(score, false)
    } else {
      setShowComment(true)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-gray-500">Sorry, we couldn't find this business.</p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Thank you!</h1>
          <p className="text-gray-500">
            We appreciate your feedback and will use it to improve.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">{business.name}</h1>
        <p className="text-gray-500 mb-6">How was your experience?</p>

        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => handleStarClick(n)}
              disabled={submitting}
              className="transition-transform hover:scale-110"
            >
              <Star
                className="w-9 h-9"
                fill={(hover || selected) >= n ? '#facc15' : 'none'}
                stroke={(hover || selected) >= n ? '#facc15' : '#d1d5db'}
              />
            </button>
          ))}
        </div>

        {showComment && (
          <div className="mt-4">
            <p className="text-sm text-gray-600 mb-2">
              We're sorry to hear that. What could we have done better?
            </p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Tell us more (optional)"
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => submitRating(selected, true)}
              disabled={submitting}
              className="mt-3 w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Submit feedback'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
