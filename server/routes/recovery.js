const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
const {
  evaluateRevenueOpportunity,
  sortRecoveryOpportunities,
} = require('../lib/recoveryEngine');

const router = express.Router();

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

async function getBusiness(req, res) {
  const { data: business, error } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (error || !business) {
    res.status(404).json({ error: 'Business not found' });
    return null;
  }

  return business;
}

function daysSince(dateString) {
  if (!dateString) return 0;

  const then = new Date(dateString).getTime();
  const now = Date.now();

  if (Number.isNaN(then)) return 0;

  return Math.max(
    0,
    Math.floor((now - then) / (1000 * 60 * 60 * 24))
  );
}

function normalizeRevenueOpportunity({
  type,
  row,
}) {
  const isEstimate = type === 'estimate';

  const openedAt = isEstimate ? row.sent_at : row.created_at;
  const lastActivityAt = row.last_reminded_at || openedAt;
  const inactiveDays = daysSince(lastActivityAt);
  const reminderCount = row.reminder_count || 0;

  const decision = evaluateRevenueOpportunity({
    type,
    amount_cents: row.amount_cents || 0,
    days_since_activity: inactiveDays,
    reminder_count: reminderCount,
    needs_human_attention: row.needs_human_attention === true,
    attention_reason: row.attention_reason || null,
  });

  return {
    id: row.id,
    type,
    source_id: row.id,

    customer_id: row.customer_id,
    customer_name: row.customers?.name || 'Customer',
    customer_phone: row.customers?.phone || null,

    amount_cents: row.amount_cents || 0,
    description: row.description || null,
    status: row.status,

    opened_at: openedAt,
    last_activity_at: lastActivityAt,
    days_since_activity: inactiveDays,
    reminder_count: reminderCount,

    needs_human_attention: row.needs_human_attention === true,
    attention_reason: row.attention_reason || null,

    ...decision,
  };
}

// -----------------------------------------------------------------------------
// GET /api/recovery/events?limit=10
//
// Recent recoveries for the "here's what Arova did" list.
// -----------------------------------------------------------------------------

router.get('/events', requireAuth, async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 10, 1),
    50
  );

  try {
    const { data, error } = await supabaseAdmin
      .from('recovery_events')
      .select(`
        id,
        source_type,
        source_id,
        amount_cents,
        reminder_count_at_recovery,
        description,
        recovered_at,
        customers ( id, name )
      `)
      .eq('business_id', business.id)
      .order('recovered_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const events = (data || []).map((event) => ({
      id: event.id,
      source_type: event.source_type,
      source_id: event.source_id,
      amount_cents: event.amount_cents,
      reminder_count_at_recovery: event.reminder_count_at_recovery,
      description: event.description,
      customer_name: event.customers?.name || 'Customer',
      recovered_at: event.recovered_at,
    }));

    res.json({
      events,
      count: events.length,
    });
  } catch (err) {
    console.error('[Recovery Events] Error:', err.message);
    res.status(500).json({ error: 'Failed to load recovery events' });
  }
});

// -----------------------------------------------------------------------------
// GET /api/recovery/summary
//
// Higher-fidelity recovery totals used by reporting surfaces.
// -----------------------------------------------------------------------------

router.get('/summary', requireAuth, async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const startOfMonthIso = startOfMonth.toISOString();

    const [allTimeRes, thisMonthRes] = await Promise.all([
      supabaseAdmin
        .from('recovery_events')
        .select('amount_cents')
        .eq('business_id', business.id),

      supabaseAdmin
        .from('recovery_events')
        .select('amount_cents')
        .eq('business_id', business.id)
        .gte('recovered_at', startOfMonthIso),
    ]);

    if (allTimeRes.error) throw allTimeRes.error;
    if (thisMonthRes.error) throw thisMonthRes.error;

    const sum = (rows) =>
      (rows || []).reduce(
        (total, row) => total + (row.amount_cents || 0),
        0
      );

    const allTimeRows = allTimeRes.data || [];
    const thisMonthRows = thisMonthRes.data || [];

    const biggest = allTimeRows.reduce(
      (max, row) =>
        row.amount_cents > max ? row.amount_cents : max,
      0
    );

    res.json({
      all_time_cents: sum(allTimeRows),
      this_month_cents: sum(thisMonthRows),
      all_time_count: allTimeRows.length,
      this_month_count: thisMonthRows.length,
      biggest_single_cents: biggest,
    });
  } catch (err) {
    console.error('[Recovery Summary] Error:', err.message);
    res.status(500).json({ error: 'Failed to load recovery summary' });
  }
});

// -----------------------------------------------------------------------------
// GET /api/recovery/queue
//
// Recovery Engine V1.
//
// Open estimates + unpaid invoices are normalized into a common opportunity
// shape and evaluated by recoveryEngine.js.
//
// The route gathers facts.
// The engine makes the recovery decision.
// The frontend renders that decision.
// -----------------------------------------------------------------------------

router.get('/queue', requireAuth, async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  try {
    const [estimatesRes, invoicesRes] = await Promise.all([
      supabaseAdmin
        .from('estimates')
        .select(`
          id,
          customer_id,
          amount_cents,
          description,
          status,
          sent_at,
          last_reminded_at,
          reminder_count,
          needs_human_attention,
          attention_reason,
          customers ( id, name, phone )
        `)
        .eq('business_id', business.id)
        .eq('status', 'sent'),

      supabaseAdmin
        .from('invoices')
        .select(`
          id,
          customer_id,
          amount_cents,
          description,
          status,
          created_at,
          last_reminded_at,
          reminder_count,
          needs_human_attention,
          attention_reason,
          customers ( id, name, phone )
        `)
        .eq('business_id', business.id)
        .eq('status', 'unpaid'),
    ]);

    if (estimatesRes.error) throw estimatesRes.error;
    if (invoicesRes.error) throw invoicesRes.error;

    const estimates = (estimatesRes.data || []).map((estimate) =>
      normalizeRevenueOpportunity({
        type: 'estimate',
        row: estimate,
      })
    );

    const invoices = (invoicesRes.data || []).map((invoice) =>
      normalizeRevenueOpportunity({
        type: 'invoice',
        row: invoice,
      })
    );

    const queue = sortRecoveryOpportunities([
      ...estimates,
      ...invoices,
    ]);

    const totalAtRiskCents = queue.reduce(
      (total, item) => total + (item.amount_cents || 0),
      0
    );

    const highPriorityCount = queue.filter(
      (item) => item.priority === 'high'
    ).length;

    const needsHumanCount = queue.filter(
      (item) => item.needs_human === true
    ).length;

    const arovaHandlingCount = queue.filter(
      (item) => item.handling_mode === 'arova'
    ).length;

    res.json({
      total_at_risk_cents: totalAtRiskCents,
      total_items: queue.length,
      high_priority_count: highPriorityCount,
      needs_human_count: needsHumanCount,
      arova_handling_count: arovaHandlingCount,
      queue,
    });
  } catch (err) {
    console.error('[Recovery Queue] Error:', err.message);
    res.status(500).json({ error: 'Failed to load recovery queue' });
  }
});

module.exports = router;
