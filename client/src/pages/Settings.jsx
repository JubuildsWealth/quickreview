import { useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Building2, Link, Save, Phone, Bell, AlertCircle } from 'lucide-react'

export default function Settings({ business, onUpdate }) {
  // ---- Business profile card state ----
  const [name, setName] = useState(business?.name || '')
  const [googleReviewLink, setGoogleReviewLink] = useState(business?.google_review_link || '')
  const [savingProfile, setSavingProfile] = useState(false)

  // ---- Hot lead alerts card state ----
  const [hotLeadEnabled, setHotLeadEnabled] = useState(
    business?.hot_lead_sms_enabled ?? true
  )
  const [ownerPhone, setOwnerPhone] = useState(business?.phone || '')
  const [savingAlerts, setSavingAlerts] = useState(false)

  // Warn if alerts are ON but phone is empty — alerts won't fire
  const alertsMisconfigured = hotLeadEnabled && !ownerPhone.trim()

  const handleProfileSubmit = async (e) => {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const { data } = await api.patch('/business', {
        name,
        google_review_link: googleReviewLink,
      })
      toast.success('Business profile saved')
      if (onUpdate) onUpdate(data.business)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save business profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleAlertsSubmit = async (e) => {
    e.preventDefault()
    // Block save if alerts are ON but phone is empty — backend also enforces
    if (alertsMisconfigured) {
      toast.error('Add a phone number or turn off hot lead alerts before saving')
      return
    }
    setSavingAlerts(true)
    try {
      const { data } = await api.patch('/business', {
        hot_lead_sms_enabled: hotLeadEnabled,
        phone: ownerPhone.trim(),
      })
      toast.success('Hot lead alerts saved')
      if (onUpdate) onUpdate(data.business)
      // Keep the normalized phone the server returned so the field reflects reality
      if (data.business?.phone !== undefined) {
        setOwnerPhone(data.business.phone || '')
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save hot lead alerts')
    } finally {
      setSavingAlerts(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your business profile and notifications.</p>
      </div>

      {/* ---------------- Business profile ---------------- */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Business profile</h2>

        <form onSubmit={handleProfileSubmit} className="space-y-5">
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
              disabled={savingProfile}
              className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>

      {/* ---------------- Hot lead alerts ---------------- */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0">
            <Bell className="w-4 h-4 text-gray-700" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Hot lead alerts</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Get a text the moment a customer replies with buying intent.
            </p>
          </div>
        </div>

        <form onSubmit={handleAlertsSubmit} className="space-y-5">
          {/* Toggle row */}
          <div className="flex items-center justify-between py-1">
            <div className="pr-4">
              <div className="text-sm font-medium text-gray-900">Send me a text for hot leads</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Arova texts you as soon as a customer shows buying intent so you can respond in minutes, not hours.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={hotLeadEnabled}
              onClick={() => setHotLeadEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
                hotLeadEnabled ? 'bg-brand-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  hotLeadEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Phone input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Owner notification phone
            </label>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="tel"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                placeholder="(559) 555-1234"
                className="w-full border border-gray-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              This is <span className="font-medium text-gray-600">your</span> personal or business owner cell phone — where hot lead alerts go. Not your Arova customer-facing number.
            </p>
          </div>

          {/* Misconfiguration warning */}
          {alertsMisconfigured && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                Alerts are on but no phone number is set. Add a number or turn off alerts to save.
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={savingAlerts || alertsMisconfigured}
              className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="w-4 h-4" />
              {savingAlerts ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
