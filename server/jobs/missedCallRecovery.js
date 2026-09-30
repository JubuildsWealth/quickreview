const twilio = require('twilio');
const { supabaseAdmin } = require('../lib/supabase');
const { normalizePhone } = require('../lib/phone');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Don't text the same caller more than once every N hours.
const DUPLICATE_TEXT_COOLDOWN_HOURS = 24;

async function handleMissedCall({
  callSid,
  callerPhone: rawCallerPhone,
  arovaPhone,
  callStatus,
  callDurationSec,
}) {
  // -------------------------------------------------------------
  // 0. Normalize caller phone immediately.
  // -------------------------------------------------------------
  const callerPhone = normalizePhone(rawCallerPhone);

  if (!callerPhone) {
    console.error(
      `[Missed Call] Could not normalize caller phone ${rawCallerPhone} for ${callSid}. Aborting.`
    );
    return;
  }

  console.log(`[Missed Call] Handling ${callSid} from ${callerPhone}`);

  // -------------------------------------------------------------
  // 1. Resolve which business owns this Arova number.
  //    Single-tenant for now.
  // -------------------------------------------------------------
  const businessId = process.env.MISSED_CALL_TEST_BUSINESS_ID;

  if (!businessId) {
    console.error(
      '[Missed Call] MISSED_CALL_TEST_BUSINESS_ID is not set.'
    );
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
  // 4. Duplicate protection.
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
  // 5. Look up existing customer.
  // -------------------------------------------------------------
  const { data: existingCustomer, error: customerLookupError } =
    await supabaseAdmin
      .from('customers')
      .select('id, name, sms_consent, opted_out, language')
      .eq('business_id', businessId)
      .eq('phone', callerPhone)
      .maybeSingle();

  if (customerLookupError) {
    console.error(
      `[Missed Call] Failed to look up customer ${callerPhone}:`,
      customerLookupError.message
    );
  }

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
  // 6. Create a stub for cold callers.
  //
  // customers has UNIQUE(business_id, phone). If two requests race,
  // one insert wins. The request that receives PostgreSQL 23505
  // reloads and reuses the row created by the winner.
  // -------------------------------------------------------------
  let customer = existingCustomer;

  if (!customer) {
    const { data: newCustomer, error: createError } =
      await supabaseAdmin
        .from('customers')
        .insert({
          business_id: businessId,
          phone: callerPhone,
          name: 'Unknown caller',
          sms_consent: true,
        })
        .select('id, name, sms_consent, opted_out, language')
        .single();

    if (createError) {
      if (createError.code === '23505') {
        console.log(
          `[Missed Call] Stub creation raced for ${callerPhone}. Reloading existing customer.`
        );

        const { data: racedCustomer, error: racedLookupError } =
          await supabaseAdmin
            .from('customers')
            .select('id, name, sms_consent, opted_out, language')
            .eq('business_id', businessId)
            .eq('phone', callerPhone)
            .maybeSingle();

        if (racedLookupError || !racedCustomer) {
          console.error(
            `[Missed Call] Duplicate stub detected for ${callerPhone}, but failed to reload customer:`,
            racedLookupError?.message || 'Customer not found after conflict'
          );
        } else {
          customer = racedCustomer;

          console.log(
            `[Missed Call] Reused concurrently created customer ${customer.id} for ${callerPhone}`
          );
        }
      } else {
        console.error(
          `[Missed Call] Failed to create stub customer for ${callerPhone}:`,
          createError.message,
          createError.details,
          createError.hint
        );
      }
    } else {
      customer = newCustomer;

      console.log(
        `[Missed Call] Created stub customer ${customer.id} for cold caller ${callerPhone}`
      );
    }
  }

  // -------------------------------------------------------------
  // 7. Build message.
  // -------------------------------------------------------------
  const language = (
    (customer && customer.language) || 'en'
  )
    .toLowerCase()
    .slice(0, 2);

  const greeting =
    customer &&
    customer.name &&
    customer.name !== 'Unknown caller'
      ? `Hi ${customer.name}`
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

  // -------------------------------------------------------------
  // 8. Send SMS + log result.
  // -------------------------------------------------------------
  try {
    const twilioMessage = await twilioClient.messages.create({
      body: message,
      from: arovaPhone,
      to: callerPhone,
    });

    // Non-fatal if outbound logging fails.
    const { error: logError } = await supabaseAdmin
      .from('sms_outbound')
      .insert({
        business_id: businessId,
        customer_id: customer ? customer.id : null,
        to_phone: callerPhone,
        body: message,
        twilio_sid: twilioMessage.sid,
        status: 'sent',
        source_type: 'missed_call_reply',
      });

    if (logError) {
      console.error(
        `[Missed Call] SMS sent, but failed to log to sms_outbound for ${callSid}:`,
        logError.message
      );
    }

    await logMissedCall({
      businessId,
      callerPhone,
      arovaPhone,
      callStatus,
      callDurationSec,
      callSid,
      customerId: customer ? customer.id : null,
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
      customerId: customer ? customer.id : null,
      skippedReason: `send_error: ${error.message}`.slice(0, 200),
    });
  }
}

// -------------------------------------------------------------
// Helper: always log the missed call.
//
// twilio_call_sid is UNIQUE. PostgreSQL 23505 means Twilio
// retried the same webhook, which is expected.
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

  if (error && error.code !== '23505') {
    console.error(
      `[Missed Call] Failed to log missed call ${callSid}:`,
      error.message
    );
  }
}

module.exports = { handleMissedCall };
