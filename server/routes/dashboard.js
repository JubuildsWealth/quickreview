const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------
// GET /api/dashboard/summary
//
// Returns the whole Revenue Recovery Dashboard payload in one call.
// Read-only aggregate over the 5 automation sources:
//   - open invoices          (money owed, unpaid)
//   - open estimates         (quotes sitting, status = 'sent')
//   - unresolved missed calls
//   - customers due for reactivation
//   - open hot leads (Day 3 will populate is_hot_lead)
//
// Also returns recovered_this_month_cents from confirmed attributions.
// No side effects. Safe to call on every dashboard render.
// ---------------------------------------------------------------
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const { data: business, error: bizErr } = await req.supabase
      .from('businesses')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (bizErr || !business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const businessId = business.id;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfMonthIso = startOfMonth.toISOString();

    // 90-day threshold mirrors the customerReactivation job's
    // REACTIVATION_AFTER_DAYS constant so the dashboard count
    // matches what the automation would actually process.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

    const [
      openInvoicesRes,
      openEstimatesRes,
      openMissedCallsRes,
      reactivationCandidatesRes,
      recoveredInvoicesRes,
      wonEstimatesRes,
      hotLeadsRes,
    ] = await Promise.all([
      req.supabase
        .from('invoices')
        .select('id, amount_cents, created_at, reminder_count')
        .eq('business_id', businessId)
        .neq('status', 'paid'),

      req.supabase
        .from('estimates')
        .select('id, amount_cents, sent_at, reminder_count')
        .eq('business_id', businessId)
        .eq('status', 'sent'),

      // Unresolved = never had an outcome, or the outcome is still open.
      req.supabase
        .from('missed_calls')
        .select('id, caller_phone, created_at, outcome')
        .eq('business_id', businessId)
        .or('outcome.is.null,outcome.eq.no_response,outcome.eq.replied'),

      // Reactivation candidates mirror the job's filter (last service
      // 90+ days ago, consent given, not opted out, has phone).
      // JS filter below applies the 3-lifetime cap.
      req.supabase
        .from('customers')
        .select('id, last_serviced_at, reactivation_count')
        .eq('business_id', businessId)
        .eq('sms_consent', true)
        .eq('opted_out', false)
        .not('phone', 'is', null)
        .not('last_serviced_at', 'is', null)
        .lte('last_serviced_at', ninetyDaysAgo),

      // Recovered invoices this month = paid + attributed.
      req.supabase
        .from('invoices')
        .select('amount_cents, paid_at')
        .eq('business_id', businessId)
        .eq('status', 'paid')
        .eq('attributed_recovered', true)
        .gte('paid_at', startOfMonthIso),

      // Won estimates this month with revenue attributed to Arova.
      req.supabase
        .from('estimates')
        .select('attributed_revenue_cents, won_at')
        .eq('business_id', businessId)
        .eq('attribution_source', 'arova_followup')
        .not('won_at', 'is', null)
        .gte('won_at', startOfMonthIso),

      req.supabase
        .from('sms_replies')
        .select('id')
        .eq('business_id', businessId)
        .eq('is_hot_lead', true)
        .is('handled_at', null),
    ]);

    const openInvoices = openInvoicesRes.data || [];
    const openEstimates = openEstimatesRes.data || [];
    const openMissedCalls = openMissedCallsRes.data || [];
    const reactCandidates = (reactivationCandidatesRes.data || []).filter(
      (c) => (c.reactivation_count || 0) < 3
    );

    const sumCents = (rows, key) =>
      rows.reduce((s, r) => s + (r[key] || 0), 0);

    // Missed-call opportunities intentionally do NOT get a fake dollar
    // value. We know they exist and how many, but not what each one is
    // worth. Don't invent numbers.
    const opportunities = {
      invoices: {
        count: openInvoices.length,
        open_cents: sumCents(openInvoices, 'amount_cents'),
      },
      estimates: {
        count: openEstimates.length,
        open_cents: sumCents(openEstimates, 'amount_cents'),
      },
      missed_calls: {
        count: openMissedCalls.length,
        open_cents: 0,
      },
      reactivation: {
        count: reactCandidates.length,
        open_cents: 0,
      },
    };

    const openTotalCents =
      opportunities.invoices.open_cents + opportunities.estimates.open_cents;

    const recoveredThisMonthCents =
      sumCents(recoveredInvoicesRes.data || [], 'amount_cents') +
      sumCents(wonEstimatesRes.data || [], 'attributed_revenue_cents');

    res.json({
      opportunities,
      open_total_cents: openTotalCents,
      recovered_this_month_cents: recoveredThisMonthCents,
      hot_leads_open: (hotLeadsRes.data || []).length,
    });
  } catch (err) {
    console.error('[Dashboard Summary] Error:', err.message);
    res.status(500).json({ error: 'Failed to load dashboard summary' });
  }
});

module.exports = router;
