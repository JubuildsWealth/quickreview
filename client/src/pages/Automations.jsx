import { useEffect, useState } from 'react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { Star, FileText, PhoneMissed, ClipboardList, UserPlus } from 'lucide-react'

const AUTOMATIONS = [
  {
    id: 'review-followup',
    setting: 'review_followup_enabled',
    icon: Star,
    title: 'Review Follow-Up',
    description:
      'Automatically remind customers who didn’t respond to your first review request, so more jobs turn into reviews.',
    available: true,
  },
  {
    id: 'invoice-recovery',
    setting: 'invoice_recovery_enabled',
    icon: FileText,
    title: 'Invoice Recovery',
    description:
      'Automatically remind customers about unpaid invoices until they’re paid — no more chasing money by hand.',
    available: false,
    status: 'launching',
  },
  {
    id: 'missed-call',
    setting: 'missed_call_enabled',
    icon: PhoneMissed,
    title: 'Missed Call Recovery',
    description:
      'Instantly text back anyone whose call you missed, so a job under a sink doesn’t become a job lost to the next guy.',
    available: false,
    status: 'soon',
  },
  {
    id: 'estimate-followup',
    setting: 'estimate_followup_enabled',
    icon: ClipboardList,
    title: 'Estimate Follow-Up',
    description:
      'Follow up on estimates you sent that haven’t been accepted yet, and win back jobs sitting on the fence.',
    available: false,
    status: 'soon',
  },
  {
    id: 'reactivation',
    setting: 'reactivation_enabled',
    icon: UserPlus,
    title: 'Customer Reactivation',
    description:
      'Reach out to past customers who haven’t booked in a while and bring them back before they call someone else.',
    available: false,
    status: 'soon',
  },
]

function StatusBadge({ available, status, enabled }) {
  if (available) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
          enabled
            ? 'bg-green-50 text-green-700'
            : 'bg-gray-100 text-gray-500'
        }`}
      >
        {enabled ? 'Active' : 'Off'}
      </span>
    )
  }

  if (status === 'launching') {
    return (
      <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
        Launching soon
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
      Coming soon
    </span>
  )
}

function Toggle({ enabled, disabled, loading, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled || loading}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-brand-600' : 'bg-gray-200'
      } ${
        disabled || loading
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export default function Automations({ business }) {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { data } = await api.get('/automations')
        setSettings(data.settings)
      } catch (e) {
        toast.error('Could not load automation settings')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [])

  const toggleAutomation = async (setting) => {
    if (!settings || saving) return

    const currentValue = settings[setting]
    const nextValue = !currentValue

    setSaving(setting)

    try {
      const { data } = await api.patch('/automations', {
        [setting]: nextValue,
      })

      setSettings(data.settings)

      toast.success(
        nextValue
          ? 'Review Follow-Up turned on'
          : 'Review Follow-Up turned off'
      )
    } catch (e) {
      toast.error('Could not update automation')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 bg-gray-50 rounded-2xl animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Automations
        </h1>

        <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
          Put your follow-ups on autopilot. Arova will catch the jobs, reviews,
          and payments that would otherwise slip through the cracks —
          automatically.
        </p>
      </div>

      <div className="space-y-3">
        {AUTOMATIONS.map(
          ({
            id,
            setting,
            icon: Icon,
            title,
            description,
            available,
            status,
          }) => {
            const enabled = available
              ? Boolean(settings?.[setting])
              : false

            return (
              <div
                key={id}
                className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 flex items-start gap-4"
              >
                <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-brand-700" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-base font-semibold text-gray-900">
                      {title}
                    </h2>

                    <StatusBadge
                      available={available}
                      status={status}
                      enabled={enabled}
                    />
                  </div>

                  <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-xl">
                    {description}
                  </p>

                  {id === 'review-followup' && enabled && (
                    <p className="text-xs text-gray-400 mt-2">
                      Arova will send one follow-up when an eligible customer
                      hasn't responded to the original review request.
                    </p>
                  )}
                </div>

                <div className="shrink-0 pt-1">
                  <Toggle
                    enabled={enabled}
                    disabled={!available}
                    loading={saving === setting}
                    onChange={() => toggleAutomation(setting)}
                  />
                </div>
              </div>
            )
          }
        )}
      </div>

      <div className="mt-6 bg-brand-50 border border-brand-100 rounded-2xl p-5 max-w-2xl">
        <p className="text-sm font-medium text-gray-900">
          Automations are built around customer control
        </p>

        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Arova only follows up with eligible customers and respects consent
          and opt-outs. Review Follow-Up sends a single automatic reminder and
          stops once the customer responds.
        </p>
      </div>
    </div>
  )
}
