const express = require('express');
const twilio = require('twilio');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
const { qualifiesForRecovery } = require('../lib/attribution');
const { normalizePhone } = require('../lib/phone');
const router = express.Router();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ---------------------------------------------------------------
// POST /api/invoices  -  create a new "money owed" record
// ---------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  const { customer_id, amount_cents, description, payment_note } = req.body;

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
    .from('invoices')
    .insert({
      business_id: business.id,
      customer_id,
      amount_cents,
      description: description || null,
      payment_note: payment_note || null,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ invoice: data });
});

// ---------------------------------------------------------------
// GET /api/invoices  -  list this business's invoices (the tracker)
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
    .from('invoices')
    .select('*, customers ( name, phone )')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ invoices: data });
});

// ---------------------------------------------------------------
// PATCH /api/invoices/:id/paid  -  mark an invoice paid
//
// Attribution rule (honest, defensible):
//   Arova-attributed  = paid AND reminder_count > 0
//     (Arova sent at least one reminder before payment landed)
//   Manual            = paid AND reminder_count = 0
//     (owner collected without Arova touching this invoice)
//
// When Arova-attributed, we also write a durable row to
// recovery_events so the hero list can show "$X from Name — after
// N Arova follow-ups". Log-failures don't block the state change:
// the invoice must be marked paid regardless.
// ---------------------------------------------------------------
router.patch('/:id/paid', requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: business, error: bizErr } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (bizErr || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  // Read the invoice first so we know reminder_count for attribution.
  const { data: current, error: readErr } = await req.supabase
    .from('invoices')
       .select('id, customer_id, amount_cents, description, reminder_count, last_reminded_at, status')
    .eq('id', id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (readErr || !current) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  if (current.status === 'paid') {
    return res.status(400).json({ error: 'Invoice already marked paid.' });
  }

   const remindersSent = current.reminder_count || 0;
  const arovaAttributed = qualifiesForRecovery({
    reminderCount: remindersSent,
    lastRemindedAt: current.last_reminded_at,
  });
  const nowIso = new Date().toISOString();

  const { data: updated, error: updateErr } = await req.supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: nowIso,
    })
    .eq('id', id)
    .eq('business_id', business.id)
    .select()
    .single();

  if (updateErr || !updated) {
    return res.status(500).json({ error: updateErr?.message || 'Update failed' });
  }

  // Write recovery event ONLY when Arova genuinely helped.
  // Use supabaseAdmin so this side-effect isn't gated by RLS.
  if (arovaAttributed) {
    const { error: eventErr } = await supabaseAdmin
      .from('recovery_events')
      .insert({
        business_id: business.id,
        customer_id: current.customer_id,
        source_type: 'invoice',
        source_id: current.id,
        amount_cents: current.amount_cents,
        reminder_count_at_recovery: remindersSent,
        description: current.description,
        recovered_at: nowIso,
      });

    if (eventErr && eventErr.code !== '23505') {
      // 23505 = unique violation — event already exists (double-tap safety)
      console.error('[Invoice paid] recovery_events insert failed:', eventErr.message);
    }
  }

  res.json({ invoice: updated });
});

// ---------------------------------------------------------------
// POST /api/invoices/:id/remind  -  text the customer a reminder
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

  const { data: invoice, error: invErr } = await req.supabase
    .from('invoices')
   .select('*, customers ( id, name, phone, sms_consent, opted_out, language )')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (invErr || !invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  const customer = invoice.customers;

  if (!customer.sms_consent) {
    return res.status(403).json({ error: 'This customer has not opted in to receive text messages.' });
  }
  if (customer.opted_out) {
    return res.status(403).json({ error: 'This customer has opted out of text messages (replied STOP).' });
  }
  if (!customer.phone) {
    return res.status(400).json({ error: 'Customer has no phone number on file.' });
  }

  // Normalize the customer's phone to E.164 before sending.
  const toPhone = normalizePhone(customer.phone);

  if (!toPhone) {
    return res.status(400).json({
      error: 'Customer phone number is not in a valid format.',
    });
  }

 const amount = (invoice.amount_cents / 100).toFixed(2);

const language = (customer.language || 'en')
  .toLowerCase()
  .slice(0, 2);

const forPartEn = invoice.description
  ? ` for ${invoice.description}`
  : '';

const payPartEn = invoice.payment_note
  ? ` ${invoice.payment_note}.`
  : '';

const forPartEs = invoice.description
  ? ` por ${invoice.description}`
  : '';

const payPartEs = invoice.payment_note
  ? ` ${invoice.payment_note}.`
  : '';

const messages = {
  en:
    `Hi ${customer.name}, quick note from ${business.name} — ` +
    `showing a $${amount} balance${forPartEn}.` +
    payPartEn +
    ` If you've already paid, please disregard. Otherwise, thanks for taking care of it. ` +
    `Reply STOP to opt out.`,

  es:
    `Hola ${customer.name}, un aviso de ${business.name} — ` +
    `mostramos un saldo pendiente de $${amount}${forPartEs}.` +
    payPartEs +
    ` Si ya realizó el pago, ignore este mensaje. De lo contrario, gracias por atenderlo. ` +
    `Responda STOP para cancelar.`,
};

const message = messages[language] || messages.en;

   let twilioMessage;
  try {
    twilioMessage = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: toPhone,
    });
  } catch (twilioError) {
    return res.status(500).json({ error: `SMS failed: ${twilioError.message}` });
  }

  // Log the outbound SMS. Non-fatal — the invoice update below
  // still runs even if this fails.
  const { error: logError } = await supabaseAdmin
    .from('sms_outbound')
    .insert({
      business_id: business.id,
      customer_id: invoice.customer_id,
      to_phone: toPhone,
      body: message,
      twilio_sid: twilioMessage.sid,
      status: 'sent',
     source_type: 'invoice_reminder_manual',
source_id: invoice.id,
    });

  if (logError) {
    console.error(
      `[Invoice manual remind] SMS sent, but failed to log to sms_outbound for ${id}:`,
      logError.message
    );
  }

  await req.supabase
    .from('invoices')
    .update({
      last_reminded_at: new Date().toISOString(),
      reminder_count: (invoice.reminder_count || 0) + 1,
    })
    .eq('id', id)
    .eq('business_id', business.id);

  res.json({ ok: true });
});

module.exports = router;
