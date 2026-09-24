const twilio = require('twilio');
const { supabaseAdmin } = require('../lib/supabase');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Production delay: send one follow-up 48 hours after the original request.
const FOLLOWUP_DELAY_MINUTES = 48 * 60;

async function runReviewFollowups() {
  console.log('[Review Follow-Up] Starting run...');

  const cutoff = new Date(
    Date.now() - FOLLOWUP_DELAY_MINUTES * 60 * 1000
  ).toISOString();

  // Find businesses that explicitly turned Review Follow-Up ON.
  const { data: enabledSettings, error: settingsError } = await supabaseAdmin
    .from('automation_settings')
    .select('business_id')
    .eq('review_followup_enabled', true);

  if (settingsError) {
    console.error(
      '[Review Follow-Up] Could not load automation settings:',
      settingsError.message
    );
    throw settingsError;
  }

  const enabledBusinessIds = (enabledSettings || []).map(
    (setting) => setting.business_id
  );

  if (enabledBusinessIds.length === 0) {
    console.log(
      '[Review Follow-Up] No businesses have this automation enabled.'
    );

    return {
      eligible: 0,
      sent: 0,
    };
  }

  // Find possible candidates.
  // Each candidate must still be claimed before any SMS is sent.
  const { data: requests, error: requestsError } = await supabaseAdmin
    .from('review_requests')
    .select(`
      id,
      business_id,
      customer_id,
      sent_at,
      review_left,
      followup_sent_at,
      followup_claimed_at,
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
        slug,
        subscription_status
      )
    `)
    .in('business_id', enabledBusinessIds)
    .eq('review_left', false)
    .is('followup_sent_at', null)
    .is('followup_claimed_at', null)
    .lte('sent_at', cutoff);

  if (requestsError) {
    console.error(
      '[Review Follow-Up] Could not load eligible requests:',
      requestsError.message
    );
    throw requestsError;
  }

  console.log(
    `[Review Follow-Up] ${requests?.length || 0} eligible request(s) found.`
  );

  let sentCount = 0;

  for (const request of requests || []) {
    const customer = request.customers;
    const business = request.businesses;

    // Safety gates before claiming the request.
    if (!customer || !business) {
      console.log(
        `[Review Follow-Up] Skipping ${request.id}: missing customer or business.`
      );
      continue;
    }

    if (business.subscription_status !== 'active') {
      console.log(
        `[Review Follow-Up] Skipping ${request.id}: subscription inactive.`
      );
      continue;
    }

    if (!customer.sms_consent) {
      console.log(
        `[Review Follow-Up] Skipping ${request.id}: no SMS consent.`
      );
      continue;
    }

    if (customer.opted_out) {
      console.log(
        `[Review Follow-Up] Skipping ${request.id}: customer opted out.`
      );
      continue;
    }

    if (!customer.phone) {
      console.log(
        `[Review Follow-Up] Skipping ${request.id}: no phone number.`
      );
      continue;
    }

    // Claim the request before sending.
    //
    // If another worker already claimed it, this update returns no row,
    // and this worker skips the request.
    const claimedAt = new Date().toISOString();

    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .from('review_requests')
      .update({
        followup_claimed_at: claimedAt,
      })
      .eq('id', request.id)
      .eq('review_left', false)
      .is('followup_sent_at', null)
      .is('followup_claimed_at', null)
      .select('id');

    if (claimError) {
      console.error(
        `[Review Follow-Up] Could not claim ${request.id}:`,
        claimError.message
      );
      continue;
    }

    if (!claimedRows || claimedRows.length === 0) {
      console.log(
        `[Review Follow-Up] Skipping ${request.id}: already claimed by another worker.`
      );
      continue;
    }

    const appUrl = process.env.APP_URL || 'http://localhost:5173';

    const reviewLink =
      `${appUrl}/rate/${business.slug || business.id}?c=${customer.id}`;

    const messages = {
      en:
        `Hi ${customer.name}! Just a quick follow-up from ${business.name}. ` +
        `If you have a moment, we'd still love to hear about your experience: ${reviewLink} ` +
        `Reply STOP to opt out.`,

      es:
        `Hola ${customer.name}! Solo un recordatorio de ${business.name}. ` +
        `Si tiene un momento, todavía nos encantaría saber sobre su experiencia: ${reviewLink} ` +
        `Responda STOP para cancelar.`,
    };

    const message = messages[customer.language] || messages.en;

    try {
      const twilioMessage = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: customer.phone,
      });

      const sentAt = new Date().toISOString();

      const { error: updateError } = await supabaseAdmin
        .from('review_requests')
        .update({
          followup_sent_at: sentAt,
        })
        .eq('id', request.id)
        .eq('followup_claimed_at', claimedAt);

      if (updateError) {
        console.error(
          `[Review Follow-Up] SMS sent, but failed to record completion for ${request.id}:`,
          updateError.message
        );
        continue;
      }

      sentCount += 1;

      console.log(
        `[Review Follow-Up] Follow-up sent for request ${request.id}. Twilio SID: ${twilioMessage.sid}`
      );
    } catch (error) {
      console.error(
        `[Review Follow-Up] SMS failed for ${request.id}:`,
        error.message
      );

      // Release the claim so a future cron run can retry.
      const { error: releaseError } = await supabaseAdmin
        .from('review_requests')
        .update({
          followup_claimed_at: null,
        })
        .eq('id', request.id)
        .eq('followup_claimed_at', claimedAt)
        .is('followup_sent_at', null);

      if (releaseError) {
        console.error(
          `[Review Follow-Up] Could not release claim for ${request.id}:`,
          releaseError.message
        );
      }
    }
  }

  console.log(
    `[Review Follow-Up] Run complete. ${sentCount} follow-up(s) sent.`
  );

  return {
    eligible: requests?.length || 0,
    sent: sentCount,
  };
}

module.exports = { runReviewFollowups };

if (require.main === module) {
  runReviewFollowups()
    .then((result) => {
      console.log('[Review Follow-Up] Finished:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Review Follow-Up] Fatal error:', error);
      process.exit(1);
    });
}
