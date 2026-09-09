import { useState } from 'react'
import toast from 'react-hot-toast'
import { Star, FileText, PhoneMissed, ClipboardList, UserPlus } from 'lucide-react'

const AUTOMATIONS = [
  {
    id: 'review-followup',
    icon: Star,
    title: 'Review Follow-Up',
    description:
      'Automatically remind customers who didn’t respond to your first review request, so more jobs turn into reviews.',
    available: true,
  },
  {
    id: 'invoice-recovery',
    icon: FileText,
    title: 'Invoice Recovery',
    description:
      'Automatically remind customers about unpaid invoices until they’re paid — no more chasing money by hand.',
    available: true,
  },
  {
    id: 'missed-call',
    icon: PhoneMissed,
    title: 'Missed Call Recovery',
    description:
      'Instantly text back anyone whose call you missed, so a job under a sink doesn’t become a job lost to the next guy.',
    available: false,
  },
  {
    id: 'estimate-followup',
    icon: ClipboardList,
    title: 'Estimate Follow-Up',
    description:
      'Follow up on estimates you sent that haven’t been accepted yet, and win back jobs sitting on the fence.',
    available: false,
  },
  {
    id: 'reactivation',
    icon: UserPlus,
    title: 'Customer Reactivation',
    description:
      'Reach out to past customers who haven’t booked in a while and bring them back before they call someone else.',
    available: false,
  },
]

export default function Automations({ business }) {
  const [enabled, setEnabled] = useState({})

  const toggle = (id, title) => {
    setEnabled((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      toast.success(next[id] ? `${title} turned on` : `${title} turned off`)
      return next
    })
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Automations
        </h1>
        <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
          Put your follow-ups on autopilot. Arova catches the jobs, reviews, and payments
          that would otherwise slip through the cracks — automatically.
        </p>
      </div>

      <div className="space-y-3">
        {AUTOMATIONS.map(({ id, icon: Icon, title, description, available }) => {
          const isOn = !!enabled[id]
          return (
            <div
              key={id}
              className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 flex items-start gap-4"
            >
              <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-brand-700" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                  {!available && (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-xl">
                  {description}
                </p>
              </div>

              <div className="shrink-0 pt-1">
                {available ? (
                  <button
                    onClick={() => toggle(id, title)}
                    role="switch"
                    aria-checked={isOn}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      isOn ? 'bg-brand-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isOn ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                ) : (
                  <div className="h-6 w-11 rounded-full bg-gray-100 opacity-60" />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 mt-6 max-w-2xl">
        Turning an automation on means Arova sends messages on your behalf. All automated
        messages respect customer consent and opt-outs, and only send during business hours.
      </p>
    </div>
  )
}
