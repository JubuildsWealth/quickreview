import { Star, FileText, PhoneMissed, ClipboardList, UserPlus } from 'lucide-react'

const AUTOMATIONS = [
  {
    id: 'review-followup',
    icon: Star,
    title: 'Review Follow-Up',
    description:
      'Automatically remind customers who didn’t respond to your first review request, so more jobs turn into reviews.',
    status: 'launching',
  },
  {
    id: 'invoice-recovery',
    icon: FileText,
    title: 'Invoice Recovery',
    description:
      'Automatically remind customers about unpaid invoices until they’re paid — no more chasing money by hand.',
    status: 'launching',
  },
  {
    id: 'missed-call',
    icon: PhoneMissed,
    title: 'Missed Call Recovery',
    description:
      'Instantly text back anyone whose call you missed, so a job under a sink doesn’t become a job lost to the next guy.',
    status: 'soon',
  },
  {
    id: 'estimate-followup',
    icon: ClipboardList,
    title: 'Estimate Follow-Up',
    description:
      'Follow up on estimates you sent that haven’t been accepted yet, and win back jobs sitting on the fence.',
    status: 'soon',
  },
  {
    id: 'reactivation',
    icon: UserPlus,
    title: 'Customer Reactivation',
    description:
      'Reach out to past customers who haven’t booked in a while and bring them back before they call someone else.',
    status: 'soon',
  },
]

function StatusBadge({ status }) {
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

export default function Automations({ business }) {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Automations
        </h1>
        <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
          Put your follow-ups on autopilot. Arova will catch the jobs, reviews, and payments
          that would otherwise slip through the cracks — automatically.
        </p>
      </div>

      <div className="space-y-3">
        {AUTOMATIONS.map(({ id, icon: Icon, title, description, status }) => (
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
                <StatusBadge status={status} />
              </div>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-xl">
                {description}
              </p>
            </div>

            {/* Toggle shown but inactive — nothing sends until these launch. */}
            <div className="shrink-0 pt-1">
              <div className="h-6 w-11 rounded-full bg-gray-100 opacity-50" title="Not yet available" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-brand-50 border border-brand-100 rounded-2xl p-5 max-w-2xl">
        <p className="text-sm font-medium text-gray-900">Automations are on the way</p>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          Review Follow-Up and Invoice Recovery are launching first. Once active, Arova sends these
          messages on your behalf — always respecting customer consent, opt-outs, and business hours.
        </p>
      </div>
    </div>
  )
}
