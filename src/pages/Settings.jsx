import { useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Building2, Link, Save } from 'lucide-react'

export default function Settings({ business, onUpdate }) {
  const [name, setName] = useState(business?.name || '')
  const [googleReviewLink, setGoogleReviewLink] = useState(business?.google_review_link || '')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { data } = await api.patch('/business', { name, google_review_link: googleReviewLink })
      toast.success('Settings saved')
      if (onUpdate) onUpdate(data.business)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your business profile and review link.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Business profile</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Business name
            </label>
            <div className="relative">
              <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Johnson Plumbing & HVAC"
                className="w-full border border-gray-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Google review link
            </label>
            <div className="relative">
              <Link className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="url"
                value={googleReviewLink}
                onChange={(e) => setGoogleReviewLink(e.target.value)}
                placeholder="https://g.page/r/YOUR_REVIEW_ID/review"
                className="w-full border border-gray-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Google Maps → your business → Share → Copy link.
            </p>
          </div>

          <div className="pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
