const express = require('express');
const twilio = require('twilio');
const { requireAuth } = require('../middleware/auth');

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

  // basic validation
  if (!customer_id) {
    return res.status(400).json({ error: 'customer_id is required' });
  }
  if (!amount_cents || amount_cents <= 0) {
    return res.status(400).json({ error: 'amount_cents must be a positive number' });
  }

  // find THIS user's business (tenant isolation - never trust a body-supplied business_id)
  const { data: business, error: bizErr } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (bizErr || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  // make sure the customer actually belongs to this business
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

  // pull invoices + the customer's name/phone so the UI can show who owes
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

  const { data, error } = await req.supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', business.id) // can only mark OWN invoices paid
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  res.json({ invoice: data });
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

  // fetch the invoice + the customer it belongs to (scoped to this business)
  const { data: invoice, error: invErr } = await req.supabase
    .from('invoices')
    .select('*, customers ( id, name, phone, sms_consent, opted_out )')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();

  if (invErr || !invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  const customer = invoice.customers;

  // same compliance gate as sms.js - never text without consent or after opt-out
  if (!customer.sms_consent) {
    return res.status(403).json({ error: 'This customer has not opted in to receive text messages.' });
  }
  if (customer.opted_out) {
    return res.status(403).json({ error: 'This customer has opted out of text messages (replied STOP).' });
  }
  if (!customer.phone) {
    return res.status(400).json({ error: 'Customer has no phone number on file.' });
  }

  // build the message. amount_cents -> dollars for display
  const amount = (invoice.amount_cents / 100).toFixed(2);
  const forPart = invoice.description ? ` for ${invoice.description}` : '';
  const payPart = invoice.payment_note ? ` ${invoice.payment_note}.` : '';

  const message =
    `Hi ${customer.name}, a friendly reminder from ${business.name}: ` +
    `you have a balance of $${amount}${forPart}.` +
    payPart +
    ` Reply STOP to opt out.`;

  try {
    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customer.phone,
    });
  } catch (twilioError) {
    return res.status(500).json({ error: `SMS failed: ${twilioError.message}` });
  }

  // record that we reminded them (bump count + timestamp)
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
