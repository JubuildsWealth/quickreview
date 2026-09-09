import { useEffect, useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Star, MessageSquare } from 'lucide-react'

export default function Feedback({ business }) {
  const [feedback, setFeedback] = useState([])
  const [loading, setLoading] = useState(true)

  const loadFeedback = async () => {
    try {
      const { data } = await api.get('/feedback')
      setFeedback(data.feedback)
    } catch {
      toast.error('Failed to load feedback')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFeedback() }, [])

  const lowRatings = feedback.filter((f) => f.rating <= 3).length

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Feedback
        </h1>
        <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
          Private feedback from customers. Reach out to unhappy customers quickly to
          win them back before they’re gone for good.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded-lg w-1/4 mb-3" />
              <div className="h-3 bg-gray-100 rounded-lg w-2/3" />
            </div>
          ))}
        </div>
      ) : feedback.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-5 h-5 text-gray-400" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">No feedback yet</h2>
          <p className="text-sm text-gray-500 mt-1.5 max-w-sm mx-auto">
            When customers rate their experience, their feedback shows up here.
          </p>
        </div>
      ) : (
        <>
          {lowRatings > 0 && (
            <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
              <p className="text-sm font-medium text-red-800">
                {lowRatings} customer{lowRatings > 1 ? 's' : ''} left a low rating. Consider
                reaching out to make it right.
              </p>
            </div>
          )}

          <div className="space-y-3">
            {feedback.map((f) => {
              const isLow = f.rating <= 3
              return (
                <div
                  key={f.id}
                  className={`bg-white rounded-2xl border p-5 ${
                    isLow ? 'border-red-200' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className="w-4 h-4"
                          fill={f.rating >= n ? '#facc15' : 'none'}
                          stroke={f.rating >= n ? '#facc15' : '#d1d5db'}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {f.comment ? (
                    <p className="text-sm text-gray-700 leading-relaxed">{f.comment}</p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No comment left.</p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
