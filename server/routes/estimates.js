const express = require('express');
const twilio = require('twilio');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
const { qualifiesForRecovery, capRecoveryAmount } = require('../lib/attribution');

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
      
    update.status = 'accepted';
    update.accepted_at = now;

       const { data: current } = await req.supabase
      .from('estimates')
      .select('id, customer_id, description, reminder_count, last_reminded_at, amount_cents')
      .eq('id', id)
      .eq('business_id', business.id)
      .single();
       if (!current) {
      return res.status(404).json({ error: 'Estimate not found' });
    }

    // Validate claimed revenue against the original estimate amount.
    // Rejects typos and inflated numbers before they enter the dashboard.
    const capResult = capRecoveryAmount(revenue_cents, current.amount_cents);
    if (!capResult.ok) {
      return res.status(400).json({ error: capResult.error });
    }

    const remindersSent = current.reminder_count || 0;
    const arovaAttributed = qualifiesForRecovery({
      reminderCount: remindersSent,
      lastRemindedAt: current.last_reminded_at,
    });

    // Prepare event payload; we insert it after the estimate update succeeds.
    if (arovaAttributed) {
      recoveryEventPayload = {
        business_id: business.id,
        customer_id: current.customer_id,
        source_type: 'estimate',
        source_id: current.id,
        amount_cents: capResult.amountCents,
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

   let twilioMessage;
  try {
    twilioMessage = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customer.phone,
    });
  } catch (twilioError) {
    return res.status(500).json({ error: `SMS failed: ${twilioError.message}` });
  }

  // Log the outbound SMS. Non-fatal — the estimate update below
  // still runs even if this fails.
  const { error: logError } = await supabaseAdmin
    .from('sms_outbound')
    .insert({
      business_id: business.id,
      customer_id: estimate.customer_id,
      to_phone: customer.phone,
      body: message,
      twilio_sid: twilioMessage.sid,
      status: 'sent',
      source_type: 'estimate_followup_manual',
    });

  if (logError) {
    console.error(
      `[Estimate manual remind] SMS sent, but failed to log to sms_outbound for ${id}:`,
      logError.message
    );
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
// ---------------------------------------------------------------
// POST /api/estimates/:id/revert-won  -  undo a "mark won"
//
// Puts the estimate back in the open-work state as if the win
// never happened:
//   - status back to 'sent'
//   - clear won_at and accepted_at
//   - delete the recovery_events row so the dashboard total
//     drops back down
//
// reminder_count is intentionally NOT reset — those SMS were
// really sent and shouldn't be pretended away. The cron's own
// max-reminder cap prevents runaway texting.
//
// Always available — a contractor might not notice the mistake
// until they see the recovery total looks off weeks later.
// ---------------------------------------------------------------
router.post('/:id/revert-won', requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: business, error: bizErr } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (bizErr || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  // Confirm the estimate exists, belongs to this business, and
  // is actually in a won state. Refuse to "revert" something that
  // was never won.
  const { data: current, error: readErr } = await req.supabase
    .from('estimates')
    .select('id, won_at')
    .eq('id', id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (readErr || !current) {
    return res.status(404).json({ error: 'Estimate not found' });
  }

  if (!current.won_at) {
    return res.status(400).json({ error: 'This estimate is not marked as won.' });
  }

  // Reset the estimate to open-work state.
  const { data: updated, error: updateErr } = await req.supabase
    .from('estimates')
    .update({
      status: 'sent',
      won_at: null,
      accepted_at: null,
    })
    .eq('id', id)
    .eq('business_id', business.id)
    .select()
    .single();

  if (updateErr || !updated) {
    return res.status(500).json({ error: updateErr?.message || 'Update failed' });
  }

  // Remove the recovery event so the dashboard number drops.
  // Uses supabaseAdmin because recovery_events writes bypass RLS
  // by the same pattern used elsewhere in this file.
  const { error: deleteErr } = await supabaseAdmin
    .from('recovery_events')
    .delete()
    .eq('business_id', business.id)
    .eq('source_type', 'estimate')
    .eq('source_id', id);

  if (deleteErr) {
    // Non-fatal: the estimate is already reverted. Log for
    // investigation but don't fail the request.
    console.error(
      `[Estimate revert-won] recovery_events delete failed for ${id}:`,
      deleteErr.message
    );
  }

  res.json({ estimate: updated });
});
module.exports = router;
