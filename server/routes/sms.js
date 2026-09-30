const express = require('express');
const twilio = require('twilio');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
const { normalizePhone } = require('../lib/phone');

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

  console.log('DEBUG /api/sms/send hit:', {
    customer_id,
    user_id: req.user?.id,
  });

  if (!customer_id) {
    return res.status(400).json({ error: 'customer_id is required' });
  }

  // Fetch the business, scoped to the logged-in user (tenant isolation)
  const { data: business, error: businessError } = await req.supabase
    .from('businesses')
    .select('id, name, slug, google_review_link, subscription_status')
    .eq('user_id', req.user.id)
    .single();

  console.log('DEBUG business lookup:', {
    business,
    businessError,
    user_id: req.user.id,
  });

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
    .select('id, name, phone, sms_consent, opted_out, language')
    .eq('id', customer_id)
    .eq('business_id', business.id)
    .single();

  console.log('DEBUG customer lookup:', {
    customer,
    customerError,
    searched_customer_id: customer_id,
    searched_business_id: business.id,
  });

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
    return res.status(400).json({
      error: 'Customer has no phone number on file.',
    });
  }
  // ----------------------------------------------------------------------

  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const reviewLink = `${appUrl}/rate/${business.slug || business.id}?c=${customer.id}`;

  // A2P-compliant message: identifies the business + includes opt-out language.
  // Carriers require both. Do not remove the opt-out line.
  const messages = {
    en:
      `Hi ${customer.name}! Thanks for choosing ${business.name}. ` +
      `We'd love to hear about your experience — leave us a quick review: ${reviewLink} ` +
      `Reply STOP to opt out.`,
    es:
      `Hola ${customer.name}! Gracias por elegir a ${business.name}. ` +
      `Nos encantaría saber sobre su experiencia — déjenos una reseña rápida: ${reviewLink} ` +
      `Responda STOP para cancelar.`,
  };

  const message = messages[customer.language] || messages.en;

  let messageSid;

  try {
    const twilioMsg = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customer.phone,
    });

    messageSid = twilioMsg.sid;
  } catch (twilioError) {
    return res.status(500).json({
      error: `SMS failed: ${twilioError.message}`,
    });
  }

  // Log the review request
  const { data: reviewRequest, error: dbError } = await req.supabase
    .from('review_requests')
    .insert({
      business_id: business.id,
      customer_id: customer.id,
      sent_at: new Date().toISOString(),
      status: 'sent',
      twilio_sid: messageSid,
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

  res.json({
    success: true,
    message_sid: messageSid,
    review_request: reviewRequest,
  });
});

// ---------------------------------------------------------------------------
// POST /api/sms/inbound  -  Twilio webhook for inbound texts
// NOTE: no requireAuth — Twilio calls this, not your dashboard.
// Twilio's signature validation is what secures it.
// Set this URL in your Twilio number's "A MESSAGE COMES IN" webhook.
// ---------------------------------------------------------------------------
router.post(
  '/inbound',
  twilio.webhook({
    validate: true,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  }),
  async (req, res) => {
    const rawFrom = (req.body.From || '').trim();
    const originalBody = (req.body.Body || '').trim();
    const normalizedBody = originalBody.toLowerCase();
    const commandBody = originalBody.toUpperCase();
    const twilioSid = req.body.MessageSid || null;

    // Normalize the sender's phone to E.164 immediately, BEFORE any DB
    // lookup. Every downstream .eq('phone', from) — STOP, START, and
    // customer lookup for reply linking — relies on this being consistent
    // with what we store in the customers table.
    //
    // If normalization fails (extremely unusual — Twilio always sends
    // E.164), we still log the reply but skip the customer lookups since
    // we can't match anything.
    const from = normalizePhone(rawFrom) || rawFrom;

    if (from !== rawFrom) {
      console.log('[Inbound SMS] Normalized phone:', {
        raw: rawFrom,
        normalized: from,
      });
    }

    const STOP_WORDS = [
      'STOP',
      'STOPALL',
      'UNSUBSCRIBE',
      'CANCEL',
      'END',
      'QUIT',
    ];

    const START_WORDS = ['START', 'YES', 'UNSTOP'];

    const HOT_LEAD_KEYWORDS = [
      'yes',
      'when',
      'tomorrow',
      'today',
      'how much',
      'come out',
      'can you',
      'send someone',
      'call me',
      'sounds good',
      "i'm interested",
      'im interested',
    ];

    try {
      // ---------------------------------------------------------------
      // STOP
      // ---------------------------------------------------------------
      // STOP commands are exact matches. A normal sentence containing
      // "stop" should not be treated as an opt-out command here.
      if (STOP_WORDS.includes(commandBody)) {
        const { data: updated, error } = await supabaseAdmin
          .from('customers')
          .update({
            opted_out: true,
            opted_out_at: new Date().toISOString(),
          })
          .eq('phone', from)
          .select('id');

        if (error) {
          throw new Error(`Failed to process STOP: ${error.message}`);
        }

        if (!updated || updated.length === 0) {
          // Edge case: STOP received from a phone number that doesn't
          // exist in customers. This is rare — most inbound messages
          // come from existing customers or missed-callers who already
          // have stub rows. Log so we can see if it happens.
          console.warn(
            '[Inbound SMS] STOP received from unknown phone (no matching customer):',
            { from }
          );
        } else {
          console.log('SMS opt-out processed:', {
            from,
            rows_updated: updated.length,
          });
        }
      }

      // ---------------------------------------------------------------
      // START
      // ---------------------------------------------------------------
      // Exact YES remains a START command because that behavior already
      // existed. Conversational messages such as "yes when can you come"
      // continue below and can become hot leads.
      else if (START_WORDS.includes(commandBody)) {
        const { data: updated, error } = await supabaseAdmin
          .from('customers')
          .update({
            opted_out: false,
            opted_out_at: null,
          })
          .eq('phone', from)
          .select('id');

        if (error) {
          throw new Error(`Failed to process START: ${error.message}`);
        }

        if (!updated || updated.length === 0) {
          console.warn(
            '[Inbound SMS] START received from unknown phone (no matching customer):',
            { from }
          );
        } else {
          console.log('SMS opt-in processed:', {
            from,
            rows_updated: updated.length,
          });
        }
      }

      // ---------------------------------------------------------------
      // NORMAL INBOUND REPLY
      // ---------------------------------------------------------------
      else {
        const matchedKeyword =
          HOT_LEAD_KEYWORDS.find((keyword) =>
            normalizedBody.includes(keyword)
          ) || null;

        const isHotLead = Boolean(matchedKeyword);

        // Find the customer who owns this phone number.
        // Unknown numbers are allowed, so maybeSingle() is intentional.
        const { data: customer, error: customerError } =
          await supabaseAdmin
            .from('customers')
            .select('id, business_id, name, phone')
            .eq('phone', from)
            .maybeSingle();

        if (customerError) {
          throw new Error(
            `Customer lookup failed: ${customerError.message}`
          );
        }
        // ---------------------------------------------------------------
// LINK REPLY TO RECENT OUTBOUND CONTEXT
// ---------------------------------------------------------------
// If this customer is replying shortly after an Arova message,
// attach the reply to the exact invoice / estimate / etc. that
// caused the conversation.
//
// We only consider messages from the last 7 days so an unrelated
// future text does not get attached to an old recovery sequence.
let relatedType = null;
let relatedId = null;

if (customer?.id && customer?.business_id) {
  const replyLinkCutoff = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: recentOutbound, error: outboundError } =
    await supabaseAdmin
      .from('sms_outbound')
      .select('source_type, source_id, sent_at')
      .eq('business_id', customer.business_id)
      .eq('customer_id', customer.id)
      .not('source_id', 'is', null)
      .gte('sent_at', replyLinkCutoff)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

  if (outboundError) {
    console.error(
      '[Inbound SMS] Failed to resolve outbound context:',
      outboundError.message
    );
  } else if (recentOutbound?.source_id) {
    const sourceTypeMap = {
      invoice_reminder_auto: 'invoice',
      invoice_reminder_manual: 'invoice',
      estimate_followup_auto: 'estimate',
      estimate_followup_manual: 'estimate',
      customer_reactivation: 'reactivation',
      missed_call_reply: 'missed_call',
      review_request: 'review_request',
      review_followup: 'review_request',
    };

    const mappedType = sourceTypeMap[recentOutbound.source_type];

    if (mappedType) {
      relatedType = mappedType;
      relatedId = recentOutbound.source_id;

      console.log('[Inbound SMS] Reply linked to outbound context:', {
        customer_id: customer.id,
        source_type: recentOutbound.source_type,
        related_type: relatedType,
        related_id: relatedId,
        outbound_sent_at: recentOutbound.sent_at,
      });
    }
  }
}
        // Log every normal inbound reply.
        // These column names have been verified against the production
        // sms_replies table.
        const { error: replyError } = await supabaseAdmin
          .from('sms_replies')
          .insert({
            business_id: customer?.business_id || null,
            customer_id: customer?.id || null,
            from_phone: from,
            body: originalBody,
            received_at: new Date().toISOString(),
            twilio_sid: twilioSid,
            is_hot_lead: isHotLead,
            hot_lead_keyword: matchedKeyword,
            related_type: relatedType,
            related_id: relatedId,
          });

        if (replyError) {
          throw new Error(
            `Failed to log SMS reply: ${replyError.message}`
          );
        }

        console.log('Inbound SMS reply logged:', {
          from,
          customer_id: customer?.id || null,
          business_id: customer?.business_id || null,
          is_hot_lead: isHotLead,
          hot_lead_keyword: matchedKeyword,
        });

              // -------------------------------------------------------------
        // HOT LEAD OWNER SMS NOTIFICATION
        // -------------------------------------------------------------
        if (isHotLead && customer?.business_id) {
          const leadIdentity = customer?.name || from;

          try {
            const { data: business, error: businessError } =
              await supabaseAdmin
                .from('businesses')
                .select('id, name, phone, hot_lead_sms_enabled')
                .eq('id', customer.business_id)
                .maybeSingle();

            if (businessError) {
              throw new Error(
                `Business lookup for hot lead failed: ${businessError.message}`
              );
            }

            if (business?.hot_lead_sms_enabled && business?.phone) {
              const ownerMessage =
                `🔥 Arova Hot Lead\n` +
                `${leadIdentity} replied: "${originalBody}"\n` +
                `Open Arova to follow up.`;

              const notification = await twilioClient.messages.create({
                body: ownerMessage,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: business.phone,
              });

              console.log('🔥 Hot lead owner SMS sent:', {
                business_id: business.id,
                customer_id: customer?.id || null,
                notification_sid: notification.sid,
              });
            } else {
              console.log('Hot lead owner SMS skipped:', {
                business_id: customer.business_id,
                reason: !business?.hot_lead_sms_enabled
                  ? 'notifications disabled'
                  : 'business phone missing',
              });
            }
          } catch (notificationError) {
            // Notification failure must never break inbound reply processing.
            console.error(
              'Hot lead owner SMS failed:',
              notificationError.message
            );
          }
        }
      }
    } catch (err) {
      // Log but still return 200 so Twilio does not retry-storm the webhook.
      console.error('Inbound webhook error:', err.message);
    }

    // Twilio handles its own STOP/START carrier-level confirmation.
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

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const totalSent = requests.length;

  const thisMonth = requests.filter((r) => {
    const sent = new Date(r.sent_at);
    const now = new Date();

    return (
      sent.getMonth() === now.getMonth() &&
      sent.getFullYear() === now.getFullYear()
    );
  }).length;

  // Group requests into weekly buckets for the growth chart (last 8 weeks)
  const now = new Date();
  const weekly = [];

  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - i * 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const count = requests.filter((r) => {
      const sent = new Date(r.sent_at);
      return sent >= weekStart && sent < weekEnd;
    }).length;

    const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;

    weekly.push({
      week: label,
      requests: count,
    });
  }

  res.json({
    stats: {
      total_sent: totalSent,
      sent_this_month: thisMonth,
      recent_requests: requests.slice(0, 10),
      weekly: weekly,
    },
  });
});

module.exports = router;
