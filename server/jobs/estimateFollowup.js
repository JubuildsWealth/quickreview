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
//
// Important handoff behavior:
// - If a customer replies after the latest Arova follow-up,
//   automation stops and the estimate is flagged for a human.
// - If all 3 automatic follow-ups are exhausted,
//   automation stops and the estimate is flagged for a human.
const FOLLOWUP_DELAY_DAYS = 2;
const MAX_FOLLOWUPS = 3;

async function flagForHumanAttention(
  estimateId,
  reason
) {
  const { error } = await supabaseAdmin
    .from('estimates')
    .update({
      needs_human_attention: true,
      attention_reason: reason,
    })
    .eq('id', estimateId)
    .eq('status', 'sent');

  if (error) {
    console.error(
      `[Estimate Follow-Up] Failed to flag ${estimateId} for human attention:`,
      error.message
    );

    return false;
  }

  return true;
}

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
      handed_off: 0,
    };
  }

  // -------------------------------------------------------------
  // 2. Find open estimates belonging to enabled businesses.
  //
  // IMPORTANT:
  // We intentionally DO NOT filter out estimates that already hit
  // MAX_FOLLOWUPS here. They need to reach the processing loop so
  // Arova can flag them for human attention instead of silently
  // forgetting about them.
  // -------------------------------------------------------------
  const { data: estimates, error: estimatesError } =
    await supabaseAdmin
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
        needs_human_attention,
        attention_reason,
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
  // 3. Determine which open estimates need processing.
  //
  // Includes:
  // - estimates due for another follow-up
  // - estimates that reached the follow-up limit and need handoff
  //
  // Estimates already handed off are ignored so every cron run
  // doesn't keep processing the same terminal item.
  // -------------------------------------------------------------
  const eligibleEstimates = (estimates || []).filter((estimate) => {
    const reminderCount = estimate.reminder_count || 0;

    // Already handed to a human. Automation owns it no longer.
    if (estimate.needs_human_attention) {
      return false;
    }

    // Extra safety: don't chase a resolved estimate.
    if (estimate.status !== 'sent') {
      return false;
    }

    if (estimate.accepted_at || estimate.declined_at) {
      return false;
    }

    // IMPORTANT:
    // Let maxed-out estimates through so the processing loop can
    // flag them as followup_limit_reached.
    if (reminderCount >= MAX_FOLLOWUPS) {
      return true;
    }

    // If we've already followed up, wait FOLLOWUP_DELAY_DAYS
    // from the most recent follow-up.
    if (estimate.last_reminded_at) {
      return estimate.last_reminded_at <= cutoff;
    }

    // Otherwise wait FOLLOWUP_DELAY_DAYS from when estimate was sent.
    return estimate.sent_at <= cutoff;
  });

  console.log(
    `[Estimate Follow-Up] ${eligibleEstimates.length} eligible estimate(s) found.`
  );

  let sentCount = 0;
  let handedOffCount = 0;

  // -------------------------------------------------------------
  // 4. Process eligible estimates.
  // -------------------------------------------------------------
  for (const estimate of eligibleEstimates) {
    const customer = estimate.customers;
    const business = estimate.businesses;

    // -----------------------------------------------------------
    // Basic safety gates.
    // -----------------------------------------------------------
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

    // -----------------------------------------------------------
    // Re-check the estimate immediately before doing anything.
    //
    // This protects against state changes between the initial
    // query and this exact point in the cron run.
    // -----------------------------------------------------------
    const { data: freshEstimate, error: freshEstimateError } =
      await supabaseAdmin
        .from('estimates')
        .select(`
          id,
          business_id,
          customer_id,
          status,
          accepted_at,
          declined_at,
          reminder_count,
          last_reminded_at,
          needs_human_attention,
          attention_reason
        `)
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

    if (
      freshEstimate.accepted_at ||
      freshEstimate.declined_at
    ) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: estimate has been resolved.`
      );
      continue;
    }

    // Another process/run may already have handed this to a human.
    if (freshEstimate.needs_human_attention) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: already needs human attention.`
      );
      continue;
    }

    const freshReminderCount =
      freshEstimate.reminder_count || 0;

    // -----------------------------------------------------------
    // 5. REPLY DETECTION
    //
    // If Arova has previously followed up on this estimate, look
    // for a customer reply explicitly linked to THIS estimate and
    // received after the most recent reminder.
    //
    // If found:
    // - send nothing
    // - stop automation
    // - hand conversation to contractor
    //
    // This check happens BEFORE follow-up-limit handling because
    // "customer_replied" is the more useful reason when both are
    // technically true after follow-up #3.
    // -----------------------------------------------------------
    if (
      freshReminderCount > 0 &&
      freshEstimate.last_reminded_at
    ) {
      const { data: linkedReply, error: replyError } =
        await supabaseAdmin
          .from('sms_replies')
          .select('id, received_at')
          .eq('business_id', estimate.business_id)
          .eq('customer_id', estimate.customer_id)
          .eq('related_type', 'estimate')
          .eq('related_id', estimate.id)
          .gte(
            'received_at',
            freshEstimate.last_reminded_at
          )
          .order('received_at', {
            ascending: false,
          })
          .limit(1)
          .maybeSingle();

      if (replyError) {
        // Fail closed on the send.
        //
        // If we cannot determine whether the customer replied,
        // do NOT risk sending another automated follow-up.
        console.error(
          `[Estimate Follow-Up] Reply lookup failed for ${estimate.id}:`,
          replyError.message
        );

        continue;
      }

      if (linkedReply) {
        const flagged =
          await flagForHumanAttention(
            estimate.id,
            'customer_replied'
          );

        if (flagged) {
          handedOffCount += 1;

          console.log(
            `[Estimate Follow-Up] Handed off ${estimate.id}: customer replied after latest follow-up.`
          );
        }

        continue;
      }
    }

    // -----------------------------------------------------------
    // 6. FOLLOW-UP LIMIT HANDOFF
    //
    // No linked customer reply was found, but Arova has exhausted
    // all automatic attempts.
    //
    // Don't silently forget the opportunity. Hand it to a human.
    // -----------------------------------------------------------
    if (freshReminderCount >= MAX_FOLLOWUPS) {
      const flagged =
        await flagForHumanAttention(
          estimate.id,
          'followup_limit_reached'
        );

      if (flagged) {
        handedOffCount += 1;

        console.log(
          `[Estimate Follow-Up] Handed off ${estimate.id}: follow-up limit reached (${freshReminderCount}/${MAX_FOLLOWUPS}).`
        );
      }

      continue;
    }

    // -----------------------------------------------------------
    // 7. Re-check timing using the freshest row.
    // -----------------------------------------------------------
    if (
      freshEstimate.last_reminded_at &&
      freshEstimate.last_reminded_at > cutoff
    ) {
      console.log(
        `[Estimate Follow-Up] Skipping ${estimate.id}: followed up too recently.`
      );
      continue;
    }

    // -----------------------------------------------------------
    // 8. Build follow-up message.
    // -----------------------------------------------------------
    const amount =
      (estimate.amount_cents / 100).toFixed(2);

    const forPart = estimate.description
      ? ` for ${estimate.description}`
      : '';

    // First = light nudge.
    // Later = slightly more direct.
    const isFirstFollowup =
      freshReminderCount === 0;

    const messages = {
      en: isFirstFollowup
        ? `Hi ${customer.name}, ${business.name} here — just checking in on the estimate we sent you${forPart} ($${amount}). Any questions we can answer? Reply STOP to opt out.`
        : `Hi ${customer.name}, following up again from ${business.name} on your estimate${forPart} ($${amount}). Still interested? Just reply and let us know. Reply STOP to opt out.`,

      es: isFirstFollowup
        ? `Hola ${customer.name}, le habla ${business.name} — solo queríamos saber sobre el presupuesto que le enviamos${forPart} ($${amount}). ¿Alguna pregunta? Responda STOP para cancelar.`
        : `Hola ${customer.name}, un seguimiento de ${business.name} sobre su presupuesto${forPart} ($${amount}). ¿Todavía interesado? Responda y díganos. Responda STOP para cancelar.`,
    };

    const language =
      (customer.language || 'en')
        .toLowerCase()
        .slice(0, 2);

    const message =
      messages[language] || messages.en;

    // -----------------------------------------------------------
    // 9. Send follow-up.
    // -----------------------------------------------------------
    try {
      const twilioMessage =
        await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: customer.phone,
        });

      const remindedAt =
        new Date().toISOString();

      // ---------------------------------------------------------
      // Log outbound SMS.
      //
      // source_id is critical: it lets the inbound webhook tie a
      // later customer reply back to this exact estimate.
      //
      // Logging remains non-fatal because Twilio already sent the
      // message. The estimate update below governs retry safety.
      // ---------------------------------------------------------
      const { error: logError } =
        await supabaseAdmin
          .from('sms_outbound')
          .insert({
            business_id: estimate.business_id,
            customer_id: estimate.customer_id,
            to_phone: customer.phone,
            body: message,
            twilio_sid: twilioMessage.sid,
            status: 'sent',
            source_type: 'estimate_followup_auto',
            source_id: estimate.id,
          });

      if (logError) {
        console.error(
          `[Estimate Follow-Up] SMS sent, but failed to log to sms_outbound for ${estimate.id}:`,
          logError.message
        );
      }

      // ---------------------------------------------------------
      // Record successful follow-up.
      //
      // We only update a still-open estimate that hasn't already
      // been handed to a human.
      // ---------------------------------------------------------
      const { error: updateError } =
        await supabaseAdmin
          .from('estimates')
          .update({
            last_reminded_at: remindedAt,
            reminder_count:
              freshReminderCount + 1,
          })
          .eq('id', estimate.id)
          .eq('status', 'sent')
          .eq('needs_human_attention', false);

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
    `[Estimate Follow-Up] Run complete. ` +
      `${sentCount} follow-up(s) sent. ` +
      `${handedOffCount} estimate(s) handed to a human.`
  );

  return {
    eligible: eligibleEstimates.length,
    sent: sentCount,
    handed_off: handedOffCount,
  };
}

module.exports = { runEstimateFollowups };

// Allows Railway to run this file directly during testing.
if (require.main === module) {
  runEstimateFollowups()
    .then((result) => {
      console.log(
        '[Estimate Follow-Up] Finished:',
        result
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(
        '[Estimate Follow-Up] Fatal error:',
        error
      );
      process.exit(1);
    });
}
