import { useEffect, useState } from 'react'
import {
  TrendingUp,
  Send,
  FileText,
  Receipt,
  RefreshCw,
  Phone,
  Star,
  Flame,
} from 'lucide-react'
import api from '../lib/api'

function formatMoney(cents = 0) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function ActionRow({ icon: Icon, label, count }) {
  if (!count) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 0',
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: '#f5f5f7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={15} color="#6e6e73" />
      </div>

      <div
        style={{
          flex: 1,
          fontSize: 14,
          color: '#1d1d1f',
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: '#1d1d1f',
        }}
      >
        {count}
      </div>
    </div>
  )
}

export default function WeeklyRecoveryReport() {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    api
      .get('/dashboard/weekly-report')
      .then((res) => {
        if (mounted) setReport(res.data)
      })
      .catch((err) => {
        console.error('Could not load weekly recovery report:', err)
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

 if (loading) {
  return (
    <div style={{ padding: 20, background: 'yellow', color: 'black' }}>
      WEEKLY REPORT: LOADING
    </div>
  )
}

if (!report) {
  return (
    <div style={{ padding: 20, background: 'red', color: 'white' }}>
      WEEKLY REPORT: NO REPORT DATA
    </div>
  )
}

  const { handled = {} } = report

  const hasActivity =
    report.recovered_cents > 0 ||
    handled.total_actions > 0 ||
    report.hot_leads_surfaced > 0

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e8e8ed',
        borderRadius: 16,
        padding: 28,
        marginTop: 24,
        fontFamily: "'Inter', -apple-system, sans-serif",
        color: '#1d1d1f',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'flex-start',
          marginBottom: 26,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#86868b',
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Weekly recovery report
          </div>

          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.02em',
            }}
          >
            Your week with Arova
          </div>
        </div>

        <div
          style={{
            fontSize: 13,
            color: '#86868b',
            whiteSpace: 'nowrap',
          }}
        >
          {formatDate(report.period.start)} – {formatDate(report.period.end)}
        </div>
      </div>

      <div
        style={{
          background: '#f5f5f7',
          borderRadius: 14,
          padding: '22px 24px',
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13,
            color: '#6e6e73',
            marginBottom: 7,
          }}
        >
          <TrendingUp size={15} />
          Revenue recovered
        </div>

        <div
          style={{
            fontSize: 38,
            lineHeight: 1.05,
            fontWeight: 650,
            letterSpacing: '-0.04em',
          }}
        >
          {formatMoney(report.recovered_cents)}
        </div>

        <div
          style={{
            marginTop: 7,
            fontSize: 13,
            color: '#86868b',
          }}
        >
          Revenue recovered after Arova follow-up
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          gap: 24,
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            <Send size={15} />
            {handled.total_actions || 0} follow-ups handled
          </div>

          <ActionRow
            icon={Receipt}
            label="Invoice reminders"
            count={handled.invoice_reminders}
          />

          <ActionRow
            icon={FileText}
            label="Estimate follow-ups"
            count={handled.estimate_followups}
          />

          <ActionRow
            icon={RefreshCw}
            label="Customer reactivations"
            count={handled.customer_reactivations}
          />

          <ActionRow
            icon={Phone}
            label="Missed call replies"
            count={handled.missed_call_replies}
          />

          <ActionRow
            icon={Star}
            label="Review follow-ups"
            count={handled.review_followups}
          />

          {!handled.total_actions && (
            <div
              style={{
                fontSize: 13,
                color: '#86868b',
                marginTop: 12,
              }}
            >
              No automated follow-ups sent yet this week.
            </div>
          )}
        </div>

        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 14,
            }}
          >
            Opportunities surfaced
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              border: '1px solid #e8e8ed',
              borderRadius: 12,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: '#f5f5f7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Flame size={17} color="#6e6e73" />
            </div>

            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                {report.hot_leads_surfaced || 0}
              </div>

              <div
                style={{
                  fontSize: 13,
                  color: '#86868b',
                }}
              >
                Hot leads surfaced
              </div>
            </div>
          </div>
        </div>
      </div>

      {hasActivity && (
        <div
          style={{
            marginTop: 24,
            paddingTop: 18,
            borderTop: '1px solid #e8e8ed',
            fontSize: 14,
            color: '#6e6e73',
            lineHeight: 1.5,
          }}
        >
          Arova recovered{' '}
          <strong style={{ color: '#1d1d1f' }}>
            {formatMoney(report.recovered_cents)}
          </strong>{' '}
          while automatically handling{' '}
          <strong style={{ color: '#1d1d1f' }}>
            {handled.total_actions || 0}
          </strong>{' '}
          follow-ups this week.
        </div>
      )}
    </div>
  )
}
