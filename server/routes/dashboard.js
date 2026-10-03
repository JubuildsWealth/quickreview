const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
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
      recoveredEventsRes,
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

           // Recovered this month, sourced from recovery_events (the
      // single source of truth for Arova-attributed recoveries
      // across both invoices and estimates).
      supabaseAdmin
        .from('recovery_events')
        .select('amount_cents')
        .eq('business_id', businessId)
        .gte('recovered_at', startOfMonthIso),

      supabaseAdmin
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
      sumCents(recoveredEventsRes.data || [], 'amount_cents');
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
// ---------------------------------------------------------------
// GET /api/dashboard/today
//
// The "Arova Today" morning brief. Answers three questions in
// one payload:
//   1. What needs your attention right now?
//   2. What did Arova handle automatically today?
//   3. What's the total money on the table right now?
//
// Read-only, safe to call on every dashboard render.
// ---------------------------------------------------------------
router.get('/today', requireAuth, async (req, res) => {
  try {
    const { data: business, error: bizErr } = await req.supabase
      .from('businesses')
      .select('id, name')
      .eq('user_id', req.user.id)
      .single();

    if (bizErr || !business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const businessId = business.id;

    // "Today" = midnight local server time.
    // Small caveat: this is server timezone (UTC on Railway),
    // not the contractor's local timezone. Acceptable for V1;
    // in V1.1 we pass a user tz offset.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayIso = startOfToday.toISOString();

    // Priority thresholds mirror /api/recovery/queue: 7+ days = high.
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const [
      hotLeadsRes,
      coldEstimatesRes,
      overdueInvoicesRes,
      handledTodayRes,
    ] = await Promise.all([
      // Hot leads waiting = unresolved replies flagged is_hot_lead
      supabaseAdmin
        .from('sms_replies')
        .select('id')
        .eq('business_id', businessId)
        .eq('is_hot_lead', true)
        .is('handled_at', null),

      // Cold estimates = status 'sent' AND (last touch OR sent_at) >= 7 days ago
      supabaseAdmin
        .from('estimates')
        .select('amount_cents, last_reminded_at, sent_at')
        .eq('business_id', businessId)
        .eq('status', 'sent'),

      // Overdue invoices = unpaid AND (last touch OR created_at) >= 7 days ago
      supabaseAdmin
        .from('invoices')
        .select('amount_cents, last_reminded_at, created_at')
        .eq('business_id', businessId)
        .neq('status', 'paid'),

      // Everything Arova handled automatically today.
      // Filters out manual sends by excluding *_manual source types.
      supabaseAdmin
        .from('sms_outbound')
        .select('source_type')
        .eq('business_id', businessId)
        .gte('sent_at', startOfTodayIso)
        .in('source_type', [
          'invoice_reminder_auto',
          'estimate_followup_auto',
          'customer_reactivation',
          'missed_call_reply',
          'review_followup',
        ]),
    ]);

    if (hotLeadsRes.error) throw hotLeadsRes.error;
    if (coldEstimatesRes.error) throw coldEstimatesRes.error;
    if (overdueInvoicesRes.error) throw overdueInvoicesRes.error;
    if (handledTodayRes.error) throw handledTodayRes.error;

    // Filter cold estimates in JS to keep query readable.
    // "Cold" = 7+ days since either last reminder or original send.
    const coldEstimates = (coldEstimatesRes.data || []).filter((e) => {
      const lastActivity = e.last_reminded_at || e.sent_at;
      return lastActivity && lastActivity <= sevenDaysAgo;
    });

    const overdueInvoices = (overdueInvoicesRes.data || []).filter((i) => {
      const lastActivity = i.last_reminded_at || i.created_at;
      return lastActivity && lastActivity <= sevenDaysAgo;
    });

    const sumCents = (rows) =>
      rows.reduce((total, row) => total + (row.amount_cents || 0), 0);

    const coldEstimatesCents = sumCents(coldEstimates);
    const overdueInvoicesCents = sumCents(overdueInvoices);
    const attentionTotalCents = coldEstimatesCents + overdueInvoicesCents;

    // Count Arova's automated actions today, grouped by source.
    const handledCounts = {
      invoice_reminders: 0,
      estimate_followups: 0,
      customer_reactivations: 0,
      missed_call_replies: 0,
      review_followups: 0,
    };

    for (const row of handledTodayRes.data || []) {
      switch (row.source_type) {
        case 'invoice_reminder_auto':
          handledCounts.invoice_reminders += 1;
          break;
        case 'estimate_followup_auto':
          handledCounts.estimate_followups += 1;
          break;
        case 'customer_reactivation':
          handledCounts.customer_reactivations += 1;
          break;
        case 'missed_call_reply':
          handledCounts.missed_call_replies += 1;
          break;
        case 'review_followup':
          handledCounts.review_followups += 1;
          break;
      }
    }

    const handledTotal =
      handledCounts.invoice_reminders +
      handledCounts.estimate_followups +
      handledCounts.customer_reactivations +
      handledCounts.missed_call_replies +
      handledCounts.review_followups;

    res.json({
      business_name: business.name,
      attention: {
        total_cents: attentionTotalCents,
        hot_leads_count: (hotLeadsRes.data || []).length,
        cold_estimates_count: coldEstimates.length,
        cold_estimates_cents: coldEstimatesCents,
        overdue_invoices_count: overdueInvoices.length,
        overdue_invoices_cents: overdueInvoicesCents,
      },
      handled_today: {
        total_actions: handledTotal,
        ...handledCounts,
      },
    });
  } catch (err) {
    console.error('[Dashboard Today] Error:', err.message);
    res.status(500).json({ error: 'Failed to load Arova Today' });
  }
});
// ---------------------------------------------------------------
// GET /api/dashboard/weekly-report
//
// Weekly proof-of-value report.
// Shows:
//   1. Revenue Arova recovered this week
//   2. Automated follow-ups Arova handled
//   3. Hot leads surfaced during the week
//
// Read-only. recovery_events is the source of truth for revenue.
// sms_outbound is the source of truth for automated actions.
// ---------------------------------------------------------------
router.get('/weekly-report', requireAuth, async (req, res) => {
  try {
    const { data: business, error: bizErr } = await req.supabase
      .from('businesses')
      .select('id, name')
      .eq('user_id', req.user.id)
      .single();

    if (bizErr || !business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const businessId = business.id;

    // Rolling 7-day window for V1.
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const [
      recoveredRes,
      outboundRes,
      hotLeadsRes,
    ] = await Promise.all([
      // Revenue actually recovered after Arova follow-up.
      supabaseAdmin
        .from('recovery_events')
        .select('amount_cents')
        .eq('business_id', businessId)
        .eq('attribution_level', 'confirmed')
        .gte('recovered_at', startIso)
        .lt('recovered_at', endIso),

      // Automated work only. Manual sends are intentionally excluded.
      supabaseAdmin
        .from('sms_outbound')
        .select('source_type')
        .eq('business_id', businessId)
        .gte('sent_at', startIso)
        .lt('sent_at', endIso)
        .in('source_type', [
          'invoice_reminder_auto',
          'estimate_followup_auto',
          'customer_reactivation',
          'missed_call_reply',
          'review_followup',
        ]),

      // Hot leads surfaced during this reporting window.
      // These count whether or not the contractor has since handled them.
    supabaseAdmin
  .from('sms_replies')
  .select('id')
  .eq('business_id', businessId)
  .eq('is_hot_lead', true)
  .gte('received_at', startIso)
  .lt('received_at', endIso),
    ]);

    if (recoveredRes.error) throw recoveredRes.error;
    if (outboundRes.error) throw outboundRes.error;
    if (hotLeadsRes.error) throw hotLeadsRes.error;

    const recoveredCents = (recoveredRes.data || []).reduce(
      (total, row) => total + (row.amount_cents || 0),
      0
    );

    const followups = {
      invoice_reminders: 0,
      estimate_followups: 0,
      customer_reactivations: 0,
      missed_call_replies: 0,
      review_followups: 0,
    };

    for (const row of outboundRes.data || []) {
      switch (row.source_type) {
        case 'invoice_reminder_auto':
          followups.invoice_reminders += 1;
          break;

        case 'estimate_followup_auto':
          followups.estimate_followups += 1;
          break;

        case 'customer_reactivation':
          followups.customer_reactivations += 1;
          break;

        case 'missed_call_reply':
          followups.missed_call_replies += 1;
          break;

        case 'review_followup':
          followups.review_followups += 1;
          break;
      }
    }

    const totalActions =
      followups.invoice_reminders +
      followups.estimate_followups +
      followups.customer_reactivations +
      followups.missed_call_replies +
      followups.review_followups;

    res.json({
      business_name: business.name,

      period: {
        start: startIso,
        end: endIso,
      },

      recovered_cents: recoveredCents,

      handled: {
        total_actions: totalActions,
        ...followups,
      },

      hot_leads_surfaced: (hotLeadsRes.data || []).length,
    });
  } catch (err) {
    console.error('[Weekly Recovery Report] Error:', err.message);
    res.status(500).json({ error: 'Failed to load weekly recovery report' });
  }
});
module.exports = router;
