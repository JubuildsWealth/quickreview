const express = require('express');
const twilio = require('twilio');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
const router = express.Router();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Reactivation constants — MUST match customerReactivation.js job so the
// dashboard's "candidates" count matches what the automation would send.
const REACTIVATION_AFTER_DAYS = 90;
const COOLDOWN_AFTER_REACTIVATION_DAYS = 180;
const MAX_REACTIVATIONS = 3;

// Batch reactivation caps — protects against runaway blasts.
const REACTIVATION_BATCH_DEFAULT = 5;
const REACTIVATION_BATCH_MAX = 10;

// ---------------------------------------------------------------
// Shared helper: resolve the caller's business.
// ---------------------------------------------------------------
async function getBusiness(req, res) {
  const { data: business, error } = await req.supabase
    .from('businesses')
    .select('id, name, subscription_status')
    .eq('user_id', req.user.id)
    .single();

  if (error || !business) {
    res.status(404).json({ error: 'Business not found' });
    return null;
  }
  return business;
}

// ---------------------------------------------------------------
// GET /api/opportunities?type=estimates|invoices|missed_calls|reactivation
//
// Returns a normalized list for the Opportunity Center on the dashboard.
// Each type has its own query but all responses share the same envelope
// so the frontend can render them uniformly.
// ---------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  const type = (req.query.type || '').toLowerCase();

  const business = await getBusiness(req, res);
  if (!business) return;

  try {
    if (type === 'estimates') {
      const { data, error } = await req.supabase
        .from('estimates')
        .select(`
          id, amount_cents, description, sent_at, reminder_count,
          customers ( id, name, phone, sms_consent, opted_out )
        `)
        .eq('business_id', business.id)
        .eq('status', 'sent')
        .order('amount_cents', { ascending: false });

      if (error) throw error;

      return res.json({
        opportunities: (data || []).map((e) => ({
          type: 'estimate',
          id: e.id,
          customer_name: e.customers?.name || 'Customer',
          customer_phone: e.customers?.phone || null,
          can_remind: !!(
            e.customers?.sms_consent &&
            !e.customers?.opted_out &&
            e.customers?.phone
          ),
          description: e.description || null,
          amount_cents: e.amount_cents,
          created_at: e.sent_at,
          reminder_count: e.reminder_count || 0,
        })),
      });
    }

    if (type === 'invoices') {
      const { data, error } = await req.supabase
        .from('invoices')
        .select(`
          id, amount_cents, description, created_at, reminder_count,
          customers ( id, name, phone, sms_consent, opted_out )
        `)
        .eq('business_id', business.id)
        .neq('status', 'paid')
        .order('amount_cents', { ascending: false });

      if (error) throw error;

      return res.json({
        opportunities: (data || []).map((i) => ({
          type: 'invoice',
          id: i.id,
          customer_name: i.customers?.name || 'Customer',
          customer_phone: i.customers?.phone || null,
          can_remind: !!(
            i.customers?.sms_consent &&
            !i.customers?.opted_out &&
            i.customers?.phone
          ),
          description: i.description || null,
          amount_cents: i.amount_cents,
          created_at: i.created_at,
          reminder_count: i.reminder_count || 0,
        })),
      });
    }

    if (type === 'missed_calls') {
      const { data, error } = await req.supabase
        .from('missed_calls')
        .select(`
          id, caller_phone, created_at, text_sent_at, outcome,
          customers ( id, name )
        `)
        .eq('business_id', business.id)
        .or('outcome.is.null,outcome.eq.no_response,outcome.eq.replied')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.json({
        opportunities: (data || []).map((m) => ({
          type: 'missed_call',
          id: m.id,
          customer_name: m.customers?.name || null,
          customer_phone: m.caller_phone,
          description: null,
          // Missed calls don't have a known dollar value. Do NOT invent one.
          amount_cents: null,
          created_at: m.created_at,
          text_sent: !!m.text_sent_at,
          outcome: m.outcome || null,
        })),
      });
    }

    if (type === 'reactivation') {
      const ninetyDaysAgo = new Date(
        Date.now() - REACTIVATION_AFTER_DAYS * 86400000
      ).toISOString();
      const cooldownCutoff = new Date(
        Date.now() - COOLDOWN_AFTER_REACTIVATION_DAYS * 86400000
      ).toISOString();

      const { data, error } = await req.supabase
        .from('customers')
        .select('id, name, phone, last_serviced_at, last_reactivation_at, reactivation_count')
        .eq('business_id', business.id)
        .eq('sms_consent', true)
        .eq('opted_out', false)
        .not('phone', 'is', null)
        .not('last_serviced_at', 'is', null)
        .lte('last_serviced_at', ninetyDaysAgo)
        .order('last_serviced_at', { ascending: true });

      if (error) throw error;

      // Apply the same filters the job uses (lifetime cap + cooldown).
      const eligible = (data || []).filter((c) => {
        if ((c.reactivation_count || 0) >= MAX_REACTIVATIONS) return false;
        if (c.last_reactivation_at && c.last_reactivation_at > cooldownCutoff) return false;
        return true;
      });

      return res.json({
        opportunities: eligible.map((c) => ({
          type: 'reactivation',
          id: c.id,
          customer_name: c.name,
          customer_phone: c.phone,
          description: null,
          amount_cents: null,
          last_serviced_at: c.last_serviced_at,
          reactivation_count: c.reactivation_count || 0,
        })),
      });
    }

    return res.status(400).json({
      error: 'Invalid type. Use estimates | invoices | missed_calls | reactivation',
    });
  } catch (err) {
    console.error('[Opportunities] Error:', err.message);
    res.status(500).json({ error: 'Failed to load opportunities' });
  }
});

// ---------------------------------------------------------------
// POST /api/opportunities/reactivate-batch
// Body: { count?: number }  — defaults to 5, hard-capped at 10.
//
// Sends the reactivation SMS to the N oldest-eligible customers.
// Uses the same message template and consent gates as the cron job.
// ---------------------------------------------------------------
router.post('/reactivate-batch', requireAuth, async (req, res) => {
  const rawCount = parseInt(req.body?.count, 10);
  const count = Number.isFinite(rawCount)
    ? Math.min(Math.max(rawCount, 1), REACTIVATION_BATCH_MAX)
    : REACTIVATION_BATCH_DEFAULT;

  const business = await getBusiness(req, res);
  if (!business) return;

  if (business.subscription_status !== 'active') {
    return res.status(402).json({ error: 'An active subscription is required.' });
  }

  const ninetyDaysAgo = new Date(
    Date.now() - REACTIVATION_AFTER_DAYS * 86400000
  ).toISOString();
  const cooldownCutoff = new Date(
    Date.now() - COOLDOWN_AFTER_REACTIVATION_DAYS * 86400000
  ).toISOString();

  const { data: candidates, error } = await req.supabase
    .from('customers')
    .select('id, name, phone, language, last_serviced_at, last_reactivation_at, reactivation_count')
    .eq('business_id', business.id)
    .eq('sms_consent', true)
    .eq('opted_out', false)
    .not('phone', 'is', null)
    .not('last_serviced_at', 'is', null)
    .lte('last_serviced_at', ninetyDaysAgo)
    .order('last_serviced_at', { ascending: true })
    .limit(50);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const eligible = (candidates || [])
    .filter((c) => {
      if ((c.reactivation_count || 0) >= MAX_REACTIVATIONS) return false;
      if (c.last_reactivation_at && c.last_reactivation_at > cooldownCutoff) return false;
      return true;
    })
    .slice(0, count);

  if (eligible.length === 0) {
    return res.json({
      sent: 0,
      skipped: 0,
      message: 'No eligible customers to reactivate right now.',
    });
  }

  let sent = 0;
  let skipped = 0;
  const errors = [];

  for (const customer of eligible) {
    const daysSinceService = Math.floor(
      (Date.now() - new Date(customer.last_serviced_at).getTime()) / 86400000
    );
    const monthsSinceService = Math.max(3, Math.round(daysSinceService / 30));

    const language = (customer.language || 'en').toLowerCase().slice(0, 2);

    const messages = {
      en:
        `Hi ${customer.name}, it's ${business.name}. It's been about ` +
        `${monthsSinceService} months since we last helped you out — just ` +
        `checking in to see if you need anything. Reply STOP to opt out.`,
      es:
        `Hola ${customer.name}, le habla ${business.name}. Han pasado unos ` +
        `${monthsSinceService} meses desde nuestro último servicio — ` +
        `queríamos saber si necesita algo. Responda STOP para cancelar.`,
    };

    const message = messages[language] || messages.en;

    try {
      await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: customer.phone,
      });

      const { error: updateError } = await req.supabase
        .from('customers')
        .update({
          last_reactivation_at: new Date().toISOString(),
          reactivation_count: (customer.reactivation_count || 0) + 1,
        })
        .eq('id', customer.id)
        .eq('business_id', business.id);

      if (updateError) {
        errors.push({ customer_id: customer.id, error: updateError.message });
        skipped += 1;
      } else {
        sent += 1;
      }
    } catch (twilioError) {
      errors.push({ customer_id: customer.id, error: twilioError.message });
      skipped += 1;
    }
  }

  res.json({
    sent,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
});


// GET /api/opportunities/hot-leads
//
// Returns unhandled hot SMS replies for the logged-in business.
// Newest replies appear first.
// ---------------------------------------------------------------
router.get('/hot-leads', requireAuth, async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  try {
   const { data, error } = await supabaseAdmin
      .from('sms_replies')
      .select(`
        id,
        customer_id,
        from_phone,
        body,
        received_at,
        hot_lead_keyword,
        handled_at,
        customers (
          id,
          name,
          phone
        )
      `)
      .eq('business_id', business.id)
      .eq('is_hot_lead', true)
      .is('handled_at', null)
      .order('received_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    const hotLeads = (data || []).map((reply) => ({
      id: reply.id,
      customer_id: reply.customer_id,
      customer_name: reply.customers?.name || null,
      customer_phone: reply.customers?.phone || reply.from_phone,
      from_phone: reply.from_phone,
      body: reply.body,
      received_at: reply.received_at,
      hot_lead_keyword: reply.hot_lead_keyword,
    }));

    return res.json({
      hot_leads: hotLeads,
      count: hotLeads.length,
    });
  } catch (err) {
    console.error('[Hot Leads] Load error:', err.message);

    return res.status(500).json({
      error: 'Failed to load hot leads',
    });
  }
});

// ---------------------------------------------------------------
// POST /api/opportunities/hot-leads/:id/handled
//
// Marks a hot lead as handled for the logged-in business.
// Business scoping prevents one tenant from modifying another.
// ---------------------------------------------------------------
router.post('/hot-leads/:id/handled', requireAuth, async (req, res) => {
  const business = await getBusiness(req, res);
  if (!business) return;

  try {
   const { data, error } = await supabaseAdmin
      .from('sms_replies')
      .update({
        handled_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('business_id', business.id)
      .eq('is_hot_lead', true)
      .is('handled_at', null)
      .select(`
        id,
        handled_at
      `)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        error: 'Hot lead not found or already handled',
      });
    }

    return res.json({
      success: true,
      hot_lead: data,
    });
  } catch (err) {
    console.error('[Hot Leads] Handle error:', err.message);

    return res.status(500).json({
      error: 'Failed to mark hot lead as handled',
    });
  }
});
// Body: {
//   missed_call_id,
//   outcome: 'booked' | 'dead' | 'replied' | 'no_response',
//   revenue_cents?  // only used when outcome === 'booked'
// }
// ---------------------------------------------------------------
router.post('/mark-missed-call-outcome', requireAuth, async (req, res) => {
  const { missed_call_id, outcome, revenue_cents } = req.body;

  const VALID_OUTCOMES = ['booked', 'dead', 'replied', 'no_response'];
  if (!missed_call_id || !VALID_OUTCOMES.includes(outcome)) {
    return res.status(400).json({
      error: 'missed_call_id and valid outcome required',
    });
  }

  const business = await getBusiness(req, res);
  if (!business) return;

  const update = {
    outcome,
    outcome_at: new Date().toISOString(),
  };

  if (outcome === 'booked' && revenue_cents && revenue_cents > 0) {
    update.attributed_revenue_cents = revenue_cents;
  }

  const { data, error } = await req.supabase
    .from('missed_calls')
    .update(update)
    .eq('id', missed_call_id)
    .eq('business_id', business.id)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Missed call not found' });
  }

  res.json({ missed_call: data });
});

module.exports = router;
