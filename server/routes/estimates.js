const express = require('express');
const twilio = require('twilio');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ---------------------------------------------------------------
// POST /api/estimates  -  create a new estimate for a customer
// ---------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  const { customer_id, amount_cents, description } = req.body;

  if (!customer_id) {
    return res.status(400).json({ error: 'customer_id is required' });
  }
  if (!amount_cents || amount_cents <= 0) {
    return res.status(400).json({ error: 'amount_cents must be a positive number' });
  }

  const { data: business, error: bizErr } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (bizErr || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { data: customer, error: custErr } = await req.supabase
    .from('customers')
    .select('id')
    .eq('id', customer_id)
    .eq('business_id', business.id)
    .single();

  if (custErr || !customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const { data, error } = await req.supabase
    .from('estimates')
    .insert({
      business_id: business.id,
      customer_id,
      amount_cents,
      description: description || null,
      status: 'sent',
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ estimate: data });
});

// ---------------------------------------------------------------
// GET /api/estimates
// ---------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  const { data: business, error: bizErr } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (bizErr || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { data, error } = await req.supabase
    .from('estimates')
    .select('*, customers ( name, phone )')
    .eq('business_id', business.id)
    .order('sent_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ estimates: data });
});

// ---------------------------------------------------------------
// PATCH /api/estimates/:id
//
// Body shapes:
//   { status: 'accepted' }
//   { status: 'declined' }
//   { won: true, revenue_cents: N }
//
// When won === true AND Arova sent at least one follow-up first,
// we ALSO write to recovery_events so the recovery hero can show
// the specific event ("$X from Name — after N Arova follow-ups").
// ---------------------------------------------------------------
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { status, won, revenue_cents } = req.body;

  const { data: business, error: bizErr } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (bizErr || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const update = {};
  const now = new Date().toISOString();

  if (status === 'accepted') {
    update.status = 'accepted';
    update.accepted_at = now;
  } else if (status === 'declined') {
    update.status = 'declined';
    update.declined_at = now;
  }

  let recoveryEventPayload = null;

  if (won === true) {
    if (!revenue_cents || revenue_cents <= 0) {
      return res.status(400).json({ error: 'revenue_cents required when marking won' });
    }
    update.won_at = now;
    update.attributed_revenue_cents = revenue_cents;
    update.status = 'accepted';
    update.accepted_at = now;

    const { data: current } = await req.supabase
      .from('estimates')
      .select('id, customer_id, description, reminder_count')
      .eq('id', id)
      .eq('business_id', business.id)
      .single();

    const remindersSent = (current && current.reminder_count) || 0;
    update.attribution_source = remindersSent > 0 ? 'arova_followup' : 'manual';

    // Prepare event payload; we insert it after the estimate update succeeds.
    if (remindersSent > 0) {
      recoveryEventPayload = {
        business_id: business.id,
        customer_id: current.customer_id,
        source_type: 'estimate',
        source_id: current.id,
        amount_cents: revenue_cents,
        reminder_count_at_recovery: remindersSent,
        description: current.description,
        recovered_at: now,
      };
    }
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await req.supabase
    .from('estimates')
    .update(update)
    .eq('id', id)
    .eq('business_id', business.id)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Estimate not found' });
  }

  if (recoveryEventPayload) {
    const { error: eventErr } = await supabaseAdmin
      .from('recovery_events')
      .insert(recoveryEventPayload);
    if (eventErr && eventErr.code !== '23505') {
      console.error('[Estimate won] recovery_events insert failed:', eventErr.message);
    }
  }

  res.json({ estimate: data });
});

// ---------------------------------------------------------------
// POST /api/estimates/:id/remind
// ---------------------------------------------------------------
router.post('/:id/remind', requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: business, error: bizErr } = await req.supabase
    .from('businesses')
    .select('id, name')
    .eq('user_id', req.user.id)
    .single();

  if (bizErr || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { data: estimate, error: estErr } = await req.supabase
    .from('estimates')
    .select('*, customers ( id, name, phone, sms_consent, opted_out, language )')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (estErr || !estimate) {
    return res.status(404).json({ error: 'Estimate not found' });
  }

  if (estimate.status !== 'sent') {
    return res.status(400).json({ error: 'Estimate is already resolved.' });
  }

  const customer = estimate.customers;

  if (!customer.sms_consent) {
    return res.status(403).json({
      error: 'This customer has not opted in to receive text messages.',
    });
  }
  if (customer.opted_out) {
    return res.status(403).json({
      error: 'This customer has opted out of text messages (replied STOP).',
    });
  }
  if (!customer.phone) {
    return res.status(400).json({ error: 'Customer has no phone number on file.' });
  }

  const amount = (estimate.amount_cents / 100).toFixed(2);
  const forPart = estimate.description ? ` for ${estimate.description}` : '';

  const messages = {
    en:
      `Hi ${customer.name}, ${business.name} here — just checking in on the estimate we sent you${forPart} ($${amount}). ` +
      `Any questions we can answer? Reply STOP to opt out.`,
    es:
      `Hola ${customer.name}, le habla ${business.name} — solo queríamos saber sobre el presupuesto que le enviamos${forPart} ($${amount}). ` +
      `¿Alguna pregunta? Responda STOP para cancelar.`,
  };

  const language = (customer.language || 'en').toLowerCase().slice(0, 2);
  const message = messages[language] || messages.en;

  try {
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customer.phone,
    });
  } catch (twilioError) {
    return res.status(500).json({ error: `SMS failed: ${twilioError.message}` });
  }

  await req.supabase
    .from('estimates')
    .update({
      last_reminded_at: new Date().toISOString(),
      reminder_count: (estimate.reminder_count || 0) + 1,
    })
    .eq('id', id)
    .eq('business_id', business.id);

  res.json({ ok: true });
});

module.exports = router;
