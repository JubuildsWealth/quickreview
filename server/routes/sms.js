const express = require('express');
const twilio = require('twilio');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ---------------------------------------------------------------------------
// POST /api/sms/send  -  send a review-request SMS to a customer
// ---------------------------------------------------------------------------
router.post('/send', requireAuth, async (req, res) => {
  const { customer_id } = req.body;

  if (!customer_id) {
    return res.status(400).json({ error: 'customer_id is required' });
  }

  // Fetch the business, scoped to the logged-in user (tenant isolation)
  const { data: business, error: businessError } = await req.supabase
    .from('businesses')
    .select('id, name, google_review_link, subscription_status')
    .eq('user_id', req.user.id)
    .single();

  if (businessError || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  // Gate on billing: don't let inactive accounts send
  if (business.subscription_status !== 'active') {
    return res.status(402).json({
      error: 'An active subscription is required to send messages.',
    });
  }

  // Fetch the customer, scoped to this business
  const { data: customer, error: customerError } = await req.supabase
    .from('customers')
    .select('id, name, phone, sms_consent, opted_out')
    .eq('id', customer_id)
    .eq('business_id', business.id)
    .single();

  if (customerError || !customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  // ---- COMPLIANCE GATE (this is what makes A2P approval + TCPA work) ----
  // Never text someone who hasn't opted in, or who has opted out.
  if (!customer.sms_consent) {
    return res.status(403).json({
      error:
        'This customer has not opted in to receive text messages. Capture consent before sending.',
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
  // ----------------------------------------------------------------------

  const reviewLink =
    business.google_review_link ||
    'https://www.google.com/search?q=' + encodeURIComponent(business.name);

  // A2P-compliant message: identifies the business + includes opt-out language.
  // Carriers require both. Do not remove the "Reply STOP" line.
  const message =
    `Hi ${customer.name}! Thanks for choosing ${business.name}. ` +
    `We'd love to hear about your experience — leave us a quick review: ${reviewLink} ` +
    `Reply STOP to opt out.`;

  let messageSid;
  try {
    const twilioMsg = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customer.phone,
    });
    messageSid = twilioMsg.sid;
  } catch (twilioError) {
    return res.status(500).json({ error: `SMS failed: ${twilioError.message}` });
  }

  // Log the review request
  const { data: reviewRequest, error: dbError } = await req.supabase
    .from('review_requests')
    .insert({
      business_id: business.id,
      customer_id: customer.id,
      sent_at: new Date().toISOString(),
      status: 'sent',
      twilio_message_sid: messageSid,
    })
    .select()
    .single();

  if (dbError) {
    // Text already went out; surface the logging problem but don't 500 the send
    return res.status(207).json({
      warning: 'Message sent but failed to log.',
      detail: dbError.message,
      message_sid: messageSid,
    });
  }

  res.json({ success: true, message_sid: messageSid, review_request: reviewRequest });
});

// ---------------------------------------------------------------------------
// POST /api/sms/inbound  -  Twilio webhook for inbound texts (STOP / START)
// NOTE: no requireAuth — Twilio calls this, not your dashboard.
// Twilio's signature validation is what secures it.
// Set this URL in your Twilio number's "A MESSAGE COMES IN" webhook.
// ---------------------------------------------------------------------------
router.post(
  '/inbound',
  twilio.webhook({ validate: true, authToken: process.env.TWILIO_AUTH_TOKEN }),
  async (req, res) => {
    const from = req.body.From;            // customer's phone number
    const body = (req.body.Body || '').trim().toUpperCase();

    const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
    const START_WORDS = ['START', 'YES', 'UNSTOP'];

    // Use the service-role client here (no logged-in user on a webhook).
    // req.supabaseAdmin should be the service-key client from your supabase setup.
    const db = req.supabaseAdmin || req.supabase;

    try {
      if (STOP_WORDS.includes(body)) {
        await db
          .from('customers')
          .update({ opted_out: true, opted_out_at: new Date().toISOString() })
          .eq('phone', from);
      } else if (START_WORDS.includes(body)) {
        await db
          .from('customers')
          .update({ opted_out: false, opted_out_at: null })
          .eq('phone', from);
      }
    } catch (err) {
      // Log but still return 200 so Twilio doesn't retry-storm you
      console.error('Inbound webhook error:', err.message);
    }

    // Twilio auto-sends its own STOP/START confirmation at the carrier level,
    // so we return an empty TwiML response.
    res.type('text/xml').send('<Response></Response>');
  }
);

// ---------------------------------------------------------------------------
// GET /api/sms/stats  -  dashboard stats for the logged-in business
// ---------------------------------------------------------------------------
router.get('/stats', requireAuth, async (req, res) => {
  const { data: business, error: businessError } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (businessError || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { data: requests, error } = await req.supabase
    .from('review_requests')
    .select('id, sent_at, status, customer_id')
    .eq('business_id', business.id)
    .order('sent_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const totalSent = requests.length;
  const thisMonth = requests.filter((r) => {
    const sent = new Date(r.sent_at);
    const now = new Date();
    return sent.getMonth() === now.getMonth() && sent.getFullYear() === now.getFullYear();
  }).length;

  res.json({
    stats: {
      total_sent: totalSent,
      sent_this_month: thisMonth,
      recent_requests: requests.slice(0, 10),
    },
  });
});

module.exports = router;
