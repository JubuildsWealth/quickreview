const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

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

// ---------------------------------------------------------------
// GET /api/recovery/events?limit=10
// Recent recoveries for the "here's what Arova did" list.
// ---------------------------------------------------------------
router.get('/events', requireAuth, async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

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

    const events = (data || []).map((e) => ({
      id: e.id,
      source_type: e.source_type,
      source_id: e.source_id,
      amount_cents: e.amount_cents,
      reminder_count_at_recovery: e.reminder_count_at_recovery,
      description: e.description,
      customer_name: e.customers?.name || 'Customer',
      recovered_at: e.recovered_at,
    }));

    res.json({ events, count: events.length });
  } catch (err) {
    console.error('[Recovery Events] Error:', err.message);
    res.status(500).json({ error: 'Failed to load recovery events' });
  }
});

// ---------------------------------------------------------------
// GET /api/recovery/summary
// Higher-fidelity totals than /dashboard/summary — includes
// biggest single recovery + all-time totals. Used by future
// Impact Report and weekly digest.
// ---------------------------------------------------------------
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

    const sum = (rows) => (rows || []).reduce((s, r) => s + (r.amount_cents || 0), 0);
    const allTimeRows = allTimeRes.data || [];
    const thisMonthRows = thisMonthRes.data || [];

    const biggest = allTimeRows.reduce(
      (max, r) => (r.amount_cents > max ? r.amount_cents : max),
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

module.exports = router;
