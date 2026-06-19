const express = require('express');
const twilio = require('twilio');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// POST /api/sms/send - send a review request SMS to a customer
router.post('/send', requireAuth, async (req, res) => {
  const { customer_id } = req.body;

  if (!customer_id) {
    return res.status(400).json({ error: 'customer_id is required' });
  }

  // Fetch the business
  const { data: business } = await req.supabase
    .from('businesses')
    .select('id, name, google_review_link, subscription_status')
    .eq('user_id', req.user.id)
    .single();

  if (!business) return res.status(404).json({ error: 'Business not found' });

  if (business.subscription_status !== 'active') {
    return res.status(403).json({ error: 'Active subscription required' });
  }

  // Fetch the customer
  const { data: customer, error: customerError } = await req.supabase
    .from('customers')
    .select('*')
    .eq('id', customer_id)
    .eq('business_id', business.id)
    .single();

  if (customerError || !customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const reviewLink = business.google_review_link || 'https://www.google.com/search?q=' + encodeURIComponent(business.name);
  const message = `Hi ${customer.name}! Thank you for choosing ${business.name}. We'd love to hear about your experience. Could you take 30 seconds to leave us a Google review? ${reviewLink} Thank you!`;

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
    console.error('Failed to log review request:', dbError);
  }

  res.json({ success: true, review_request: reviewRequest });
});

// GET /api/sms/stats - get SMS stats for the business
router.get('/stats', requireAuth, async (req, res) => {
  const { data: business } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!business) return res.status(404).json({ error: 'Business not found' });

  const { data: requests, error } = await req.supabase
    .from('review_requests')
    .select('id, sent_at, status, customer_id')
    .eq('business_id', business.id)
    .order('sent_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const totalSent = requests.length;
  const thisMonth = requests.filter(r => {
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
