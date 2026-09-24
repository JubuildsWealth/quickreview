const twilio = require('twilio');
const { supabaseAdmin } = require('../lib/supabase');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Don't text the same caller more than once every N hours.
// Prevents someone who calls 5 times in a row from getting 5 texts.
const DUPLICATE_TEXT_COOLDOWN_HOURS = 24;

async function handleMissedCall({
  callSid,
  callerPhone,
  arovaPhone,
  callStatus,
  callDurationSec,
}) {
  console.log(`[Missed Call] Handling ${callSid} from ${callerPhone}`);

  // -------------------------------------------------------------
  // 1. Resolve which business owns this Arova number.
  //    Single-tenant for now.
  // -------------------------------------------------------------
  const businessId = process.env.MISSED_CALL_TEST_BUSINESS_ID;

  if (!businessId) {
    console.error('[Missed Call] MISSED_CALL_TEST_BUSINESS_ID is not set.');
    return;
  }

  const { data: business, error: businessError } = await supabaseAdmin
    .from('businesses')
    .select('id, name, subscription_status')
    .eq('id', businessId)
    .single();

  if (businessError || !business) {
    console.error(
      '[Missed Call] Could not load business:',
      businessError?.message
    );
    return;
  }

  // -------------------------------------------------------------
  // 2. Check automation is enabled for this business.
  // -------------------------------------------------------------
  const { data: settings } = await supabaseAdmin
    .from('automation_settings')
    .select('missed_call_enabled')
    .eq('business_id', businessId)
    .single();

  if (!settings || !settings.missed_call_enabled) {
    console.log(
      `[Missed Call] Automation disabled for business ${businessId}. Logging call but not texting.`
    );
    await logMissedCall({
      businessId,
      callerPhone,
      arovaPhone,
      callStatus,
      callDurationSec,
      callSid,
      skippedReason: 'automation_disabled',
    });
    return;
  }

  // -------------------------------------------------------------
  // 3. Subscription check.
  // -------------------------------------------------------------
  if (business.subscription_status !== 'active') {
    console.log(
      `[Missed Call] Subscription inactive for ${businessId}. Skipping.`
    );
    await logMissedCall({
      businessId,
      callerPhone,
      arovaPhone,
      callStatus,
      callDurationSec,
      callSid,
      skippedReason: 'subscription_inactive',
    });
    return;
  }

  // -------------------------------------------------------------
  // 4. Duplicate protection: did we already text this caller
  //    recently for this business?
  // -------------------------------------------------------------
  const cooldownCutoff = new Date(
    Date.now() - DUPLICATE_TEXT_COOLDOWN_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data: recentTexts } = await supabaseAdmin
    .from('missed_calls')
    .select('id, text_sent_at')
    .eq('business_id', businessId)
    .eq('caller_phone', callerPhone)
    .not('text_sent_at', 'is', null)
    .gte('text_sent_at', cooldownCutoff)
    .limit(1);

  if (recentTexts && recentTexts.length > 0) {
    console.log(
      `[Missed Call] Already texted ${callerPhone} recently. Skipping.`
    );
    await logMissedCall({
      businessId,
      callerPhone,
      arovaPhone,
      callStatus,
      callDurationSec,
      callSid,
      skippedReason: 'duplicate_recent',
    });
    return;
  }

  // -------------------------------------------------------------
  // 5. Look up if this caller is an existing customer.
  //    If so, respect their consent + opt-out settings.
  //    If not, we still text them — cold missed-call replies
  //    are standard in this category and expected by the caller
  //    (they just tried to reach the business).
  // -------------------------------------------------------------
  const { data: existingCustomer } = await supabaseAdmin
    .from('customers')
    .select('id, name, sms_consent, opted_out, language')
    .eq('business_id', businessId)
    .eq('phone', callerPhone)
    .maybeSingle();

  if (existingCustomer && existingCustomer.opted_out) {
    console.log(
      `[Missed Call] Caller ${callerPhone} has opted out. Skipping.`
    );
    await logMissedCall({
      businessId,
      callerPhone,
      arovaPhone,
      callStatus,
      callDurationSec,
      callSid,
      customerId: existingCustomer.id,
      skippedReason: 'opted_out',
    });
    return;
  }

  // -------------------------------------------------------------
  // 6. Build and send the message.
  // -------------------------------------------------------------
  const language = (
    (existingCustomer && existingCustomer.language) || 'en'
  ).toLowerCase().slice(0, 2);

  const greeting = existingCustomer
    ? `Hi ${existingCustomer.name}`
    : 'Hi';

  const messages = {
    en:
      `${greeting}, this is ${business.name}. Sorry we missed your call — ` +
      `how can we help? Reply here and we'll get right back to you. ` +
      `Reply STOP to opt out.`,

    es:
      `${greeting}, le habla ${business.name}. Disculpe que no pudimos ` +
      `contestar — ¿en qué le podemos ayudar? Responda aquí y le atenderemos ` +
      `enseguida. Responda STOP para cancelar.`,
  };

  const message = messages[language] || messages.en;

  try {
    const twilioMessage = await twilioClient.messages.create({
      body: message,
      from: arovaPhone,   // reply from the same Arova number they called
      to: callerPhone,
    });

    await logMissedCall({
      businessId,
      callerPhone,
      arovaPhone,
      callStatus,
      callDurationSec,
      callSid,
      customerId: existingCustomer ? existingCustomer.id : null,
      textSentAt: new Date().toISOString(),
      textTwilioSid: twilioMessage.sid,
    });

    console.log(
      `[Missed Call] Text sent to ${callerPhone}. Twilio SID: ${twilioMessage.sid}`
    );
  } catch (error) {
    console.error(
      `[Missed Call] Failed to send text for ${callSid}:`,
      error.message
    );

    await logMissedCall({
      businessId,
      callerPhone,
      arovaPhone,
      callStatus,
      callDurationSec,
      callSid,
      customerId: existingCustomer ? existingCustomer.id : null,
      skippedReason: `send_error: ${error.message}`.slice(0, 200),
    });
  }
}

// -------------------------------------------------------------
// Helper: always log the missed call, whether we texted or not.
// twilio_call_sid is UNIQUE — insert conflicts are ignored so
// Twilio's automatic webhook retries don't create dup rows.
// -------------------------------------------------------------
async function logMissedCall({
  businessId,
  callerPhone,
  arovaPhone,
  callStatus,
  callDurationSec,
  callSid,
  customerId = null,
  textSentAt = null,
  textTwilioSid = null,
  skippedReason = null,
}) {
  const { error } = await supabaseAdmin
    .from('missed_calls')
    .insert({
      business_id: businessId,
      customer_id: customerId,
      caller_phone: callerPhone,
      arova_phone: arovaPhone,
      call_status: callStatus,
      call_duration_sec: callDurationSec,
      twilio_call_sid: callSid,
      text_sent_at: textSentAt,
      text_twilio_sid: textTwilioSid,
      text_skipped_reason: skippedReason,
    });

  // Duplicate key on twilio_call_sid = Twilio retried the webhook.
  // That's expected, not an error.
  if (error && error.code !== '23505') {
    console.error(
      `[Missed Call] Failed to log missed call ${callSid}:`,
      error.message
    );
  }
}

module.exports = { handleMissedCall };
