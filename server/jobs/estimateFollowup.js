const twilio = require('twilio');
const { supabaseAdmin } = require('../lib/supabase');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Production V1:
// First follow-up 2 days after the estimate is sent.
// Additional follow-ups also spaced 2 days apart.
// Never send more than 3 automatic follow-ups.
// Estimates are more time-sensitive than invoices — a stale
// estimate loses to a competitor faster than a stale invoice
// gets written off, so we chase a bit sooner.
const FOLLOWUP_DELAY_DAYS = 2;
const MAX_FOLLOWUPS = 3;

async function runEstimateFollowups() {
  console.log('[Estimate Follow-Up] Starting run...');

  const cutoff = new Date(
    Date.now() - FOLLOWUP_DELAY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // -------------------------------------------------------------
  // 1. Find businesses that explicitly enabled Estimate Follow-Up.
  // -------------------------------------------------------------
  const { data: enabledSettings, error: settingsError } =
    await supabaseAdmin
      .from('automation_settings')
      .select('business_id')
      .eq('estimate_followup_enabled', true);

  if (settingsError) {
    console.error(
      '[Estimate Follow-Up] Could not load automation settings:',
      settingsError.message
    );
    throw settingsError;
  }

  const enabledBusinessIds = (enabledSettings || []).map(
    (setting) => setting.business_id
  );

  if (enabledBusinessIds.length === 0) {
    console.log(
      '[Estimate Follow-Up] No businesses have this automation enabled.'
    );

    return {
      eligible: 0,
      sent: 0,
    };
  }

  // -------------------------------------------------------------
  // 2. Find open estimates belonging to enabled businesses.
  //    "Open" = status is 'sent' (not accepted, declined, expired).
  // -------------------------------------------------------------
  const { data: estimates, error: estimatesError } = await supabaseAdmin
    .from('estimates')
    .select(`
      id,
      business_id,
      customer_id,
      amount_cents,
      description,
      status,
      sent_at,
      accepted_at,
      declined_at,
      last_reminded_at,
      reminder_count,
      customers (
        id,
        name,
        phone,
        sms_consent,
        opted_out,
        language
      ),
      businesses (
        id,
        name,
        subscription_status
      )
    `)
    .in('business_id', enabledBusinessIds)
    .eq('status', 'sent');

  if (estimatesError) {
    console.error(
      '[Estimate Follow-Up] Could not load estimates:',
      estimatesError.message
    );
    throw estimatesError;
  }

  // -------------------------------------------------------------
  // 3. Determine which open estimates are actually due.
  // -------------------------------------------------------------
  const eligibleEstimates = (estimates || []).filter((estimate) => {
    const reminderCount = estimate.reminder_count || 0;

    // Hard stop after 3 automatic follow-ups.
    if (reminderCount >= MAX_FOLLOWUPS) {
      return false;
    }

    // Extra safety: don't chase a resolved estimate.
    if (estimate.status !== 'sent') {
      return false;
    }

    if (estimate.accepted_at || estimate.declined_at) {
      return false;
    }

    // If we've already followed up, wait FOLLOWUP_DELAY_DAYS
    // from the most recent follow-up.
    if (estimate.last_reminded_at) {
      return estimate.last_reminded_at <= cutoff;
    }

    // Otherwise wait FOLLOWUP_DELAY_DAYS from when the estimate was sent.
    return estimate.sent_at <= cutoff;
  });

  console.log(
    `[Estimate Follow-Up] ${eligibleEstimates.length} eligible estimate(s) found.`
  );

  let sentCount = 0;

  // -------------------------------------------------------------
  // 4. Process eligible estimates.
  // -------------------------------------------------------------
  for (const estimate of eligibleEstimates) {
    const customer = estimate.customers;
    const business = estimate.businesses;

    // Safety gates.
    if (!customer || !business) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: missing customer or business.`
      );
      continue;
    }

    if (business.subscription_status !== 'active') {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: subscription inactive.`
      );
      continue;
    }

    if (!customer.sms_consent) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: no SMS consent.`
      );
      continue;
    }

    if (customer.opted_out) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: customer opted out.`
      );
      continue;
    }

    if (!customer.phone) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: no phone number.`
      );
      continue;
    }

    // Re-check the estimate immediately before sending.
    // This reduces the chance of chasing an estimate that was
    // just accepted or declined after the initial query.
    const { data: freshEstimate, error: freshEstimateError } =
      await supabaseAdmin
        .from('estimates')
        .select('status, accepted_at, declined_at, reminder_count, last_reminded_at')
        .eq('id', estimate.id)
        .single();

    if (freshEstimateError || !freshEstimate) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: could not re-check estimate.`
      );
      continue;
    }

    if (freshEstimate.status !== 'sent') {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: status is now '${freshEstimate.status}'.`
      );
      continue;
    }

    if (freshEstimate.accepted_at || freshEstimate.declined_at) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: estimate has been resolved.`
      );
      continue;
    }

    const freshReminderCount = freshEstimate.reminder_count || 0;

    if (freshReminderCount >= MAX_FOLLOWUPS) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: follow-up limit reached.`
      );
      continue;
    }

    // Re-check timing using the freshest row.
    if (
      freshEstimate.last_reminded_at &&
      freshEstimate.last_reminded_at > cutoff
    ) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: followed up too recently.`
      );
      continue;
    }

    const amount = (estimate.amount_cents / 100).toFixed(2);

    const forPart = estimate.description
      ? ` for ${estimate.description}`
      : '';

    // Message varies slightly by which follow-up this is.
    // First = light nudge. Later = a bit more direct.
    const isFirstFollowup = freshReminderCount === 0;

    const messages = {
      en: isFirstFollowup
        ? `Hi ${customer.name}, ${business.name} here — just checking in on the estimate we sent you${forPart} ($${amount}). Any questions we can answer? Reply STOP to opt out.`
        : `Hi ${customer.name}, following up again from ${business.name} on your estimate${forPart} ($${amount}). Still interested? Just reply and let us know. Reply STOP to opt out.`,

      es: isFirstFollowup
        ? `Hola ${customer.name}, le habla ${business.name} — solo queríamos saber sobre el presupuesto que le enviamos${forPart} ($${amount}). ¿Alguna pregunta? Responda STOP para cancelar.`
        : `Hola ${customer.name}, un seguimiento de ${business.name} sobre su presupuesto${forPart} ($${amount}). ¿Todavía interesado? Responda y díganos. Responda STOP para cancelar.`,
    };

    const language = (customer.language || 'en').toLowerCase().slice(0, 2);
    const message = messages[language] || messages.en;

    try {
      const twilioMessage = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: customer.phone,
      });

      const remindedAt = new Date().toISOString();

      // Record the successful follow-up.
      const { error: updateError } = await supabaseAdmin
        .from('estimates')
        .update({
          last_reminded_at: remindedAt,
          reminder_count: freshReminderCount + 1,
        })
        .eq('id', estimate.id)
        .eq('status', 'sent');

      if (updateError) {
        console.error(
          `[Estimate Follow-Up] SMS sent, but failed to record follow-up for ${estimate.id}:`,
          updateError.message
        );
        continue;
      }

      sentCount += 1;

      console.log(
        `[Estimate Follow-Up] Follow-up sent for estimate ${estimate.id}. ` +
        `Follow-up ${freshReminderCount + 1}/${MAX_FOLLOWUPS}. ` +
        `Twilio SID: ${twilioMessage.sid}`
      );
    } catch (error) {
      console.error(
        `[Estimate Follow-Up] Failed for estimate ${estimate.id}:`,
        error.message
      );
    }
  }

  console.log(
    `[Estimate Follow-Up] Run complete. ${sentCount} follow-up(s) sent.`
  );

  return {
    eligible: eligibleEstimates.length,
    sent: sentCount,
  };
}

module.exports = { runEstimateFollowups };

// Allows Railway to run this file directly during testing.
if (require.main === module) {
  runEstimateFollowups()
    .then((result) => {
      console.log('[Estimate Follow-Up] Finished:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Estimate Follow-Up] Fatal error:', error);
      process.exit(1);
    });
}
