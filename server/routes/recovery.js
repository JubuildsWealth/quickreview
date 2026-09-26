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

function daysSince(dateString) {
  if (!dateString) return 0;

  const then = new Date(dateString).getTime();
  const now = Date.now();

  if (Number.isNaN(then)) return 0;

  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function getPriority(daysSinceActivity) {
  if (daysSinceActivity >= 7) {
    return {
      priority: 'high',
      priority_rank: 3,
    };
  }

  if (daysSinceActivity >= 3) {
    return {
      priority: 'medium',
      priority_rank: 2,
    };
  }

  return {
    priority: 'low',
    priority_rank: 1,
  };
}

function buildReason(type, daysSinceActivity, reminderCount) {
  const noun = type === 'estimate' ? 'follow-up' : 'reminder';

  if (reminderCount === 0) {
    if (daysSinceActivity === 0) {
      return `No ${noun} sent yet`;
    }

    if (daysSinceActivity === 1) {
      return `No ${noun} sent · open 1 day`;
    }

    return `No ${noun} sent · open ${daysSinceActivity} days`;
  }

  if (daysSinceActivity === 0) {
    return `${reminderCount} ${noun}${reminderCount === 1 ? '' : 's'} sent · contacted today`;
  }

  if (daysSinceActivity === 1) {
    return `${reminderCount} ${noun}${reminderCount === 1 ? '' : 's'} sent · last contact 1 day ago`;
  }

  return `${reminderCount} ${noun}${reminderCount === 1 ? '' : 's'} sent · last contact ${daysSinceActivity} days ago`;
}

// ---------------------------------------------------------------
// GET /api/recovery/events?limit=10
// Recent recoveries for the "here's what Arova did" list.
// ---------------------------------------------------------------
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

    res.json({
      events,
      count: events.length,
    });
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

// ---------------------------------------------------------------
// GET /api/recovery/queue
//
// Open estimates + unpaid invoices, normalized into one queue.
//
// Priority is intentionally deterministic:
//   High   = 7+ days since last activity
//   Medium = 3–6 days
//   Low    = 0–2 days
//
// Within the same priority, larger opportunities rank first.
// ---------------------------------------------------------------
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
          customers ( id, name, phone )
        `)
        .eq('business_id', business.id)
        .neq('status', 'paid'),
    ]);

    if (estimatesRes.error) throw estimatesRes.error;
    if (invoicesRes.error) throw invoicesRes.error;

    const estimates = (estimatesRes.data || []).map((estimate) => {
      const lastActivityAt =
        estimate.last_reminded_at || estimate.sent_at;

      const inactiveDays = daysSince(lastActivityAt);
      const priorityData = getPriority(inactiveDays);
      const reminderCount = estimate.reminder_count || 0;

      return {
        id: estimate.id,
        type: 'estimate',
        customer_id: estimate.customer_id,
        customer_name: estimate.customers?.name || 'Customer',
        customer_phone: estimate.customers?.phone || null,
        amount_cents: estimate.amount_cents || 0,
        description: estimate.description || null,
        status: estimate.status,
        opened_at: estimate.sent_at,
        last_activity_at: lastActivityAt,
        days_since_activity: inactiveDays,
        reminder_count: reminderCount,
        priority: priorityData.priority,
        priority_rank: priorityData.priority_rank,
        reason: buildReason(
          'estimate',
          inactiveDays,
          reminderCount
        ),
        action_label: 'Follow up',
      };
    });

    const invoices = (invoicesRes.data || []).map((invoice) => {
      const lastActivityAt =
        invoice.last_reminded_at || invoice.created_at;

      const inactiveDays = daysSince(lastActivityAt);
      const priorityData = getPriority(inactiveDays);
      const reminderCount = invoice.reminder_count || 0;

      return {
        id: invoice.id,
        type: 'invoice',
        customer_id: invoice.customer_id,
        customer_name: invoice.customers?.name || 'Customer',
        customer_phone: invoice.customers?.phone || null,
        amount_cents: invoice.amount_cents || 0,
        description: invoice.description || null,
        status: invoice.status,
        opened_at: invoice.created_at,
        last_activity_at: lastActivityAt,
        days_since_activity: inactiveDays,
        reminder_count: reminderCount,
        priority: priorityData.priority,
        priority_rank: priorityData.priority_rank,
        reason: buildReason(
          'invoice',
          inactiveDays,
          reminderCount
        ),
        action_label: 'Send reminder',
      };
    });

    const queue = [...estimates, ...invoices].sort((a, b) => {
      if (b.priority_rank !== a.priority_rank) {
        return b.priority_rank - a.priority_rank;
      }

      if (b.amount_cents !== a.amount_cents) {
        return b.amount_cents - a.amount_cents;
      }

      return (
        new Date(a.last_activity_at).getTime() -
        new Date(b.last_activity_at).getTime()
      );
    });

    const totalAtRiskCents = queue.reduce(
      (total, item) => total + (item.amount_cents || 0),
      0
    );

    const highPriorityCount = queue.filter(
      (item) => item.priority === 'high'
    ).length;

    res.json({
      total_at_risk_cents: totalAtRiskCents,
      total_items: queue.length,
      high_priority_count: highPriorityCount,
      queue,
    });
  } catch (err) {
    console.error('[Recovery Queue] Error:', err.message);
    res.status(500).json({ error: 'Failed to load recovery queue' });
  }
});

module.exports = router;
