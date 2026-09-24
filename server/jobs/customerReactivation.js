const twilio = require('twilio');
const { supabaseAdmin } = require('../lib/supabase');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Production V1:
// Reach out to customers whose last service is 90+ days old.
// Only send one reactivation, then wait 180 days before we
// consider them again — this prevents pestering.
// Cap total automatic reactivations per customer at 3 lifetime
// to avoid becoming spam after a couple of years.
const REACTIVATION_AFTER_DAYS = 90;
const COOLDOWN_AFTER_REACTIVATION_DAYS = 180;
const MAX_REACTIVATIONS = 3;

async function runCustomerReactivation() {
  console.log('[Customer Reactivation] Starting run...');

  const serviceCutoff = new Date(
    Date.now() - REACTIVATION_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const cooldownCutoff = new Date(
    Date.now() - COOLDOWN_AFTER_REACTIVATION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // -------------------------------------------------------------
  // 1. Find businesses that explicitly enabled Reactivation.
  // -------------------------------------------------------------
  const { data: enabledSettings, error: settingsError } =
    await supabaseAdmin
      .from('automation_settings')
      .select('business_id')
      .eq('reactivation_enabled', true);

  if (settingsError) {
    console.error(
      '[Customer Reactivation] Could not load automation settings:',
      settingsError.message
    );
    throw settingsError;
  }

  const enabledBusinessIds = (enabledSettings || []).map(
    (setting) => setting.business_id
  );

  if (enabledBusinessIds.length === 0) {
    console.log(
      '[Customer Reactivation] No businesses have this automation enabled.'
    );

    return {
      eligible: 0,
      sent: 0,
    };
  }

  // -------------------------------------------------------------
  // 2. Find candidate customers.
  //    - belong to enabled businesses
  //    - have a last_serviced_at
  //    - have SMS consent and are not opted out
  //    - have a phone number
  //    - have not hit the lifetime cap
  //
  // We do timing filtering in JS below to keep the query readable.
  // -------------------------------------------------------------
  const { data: customers, error: customersError } = await supabaseAdmin
    .from('customers')
    .select(`
      id,
      business_id,
      name,
      phone,
      sms_consent,
      opted_out,
      language,
      last_serviced_at,
      last_reactivation_at,
      reactivation_count,
      businesses (
        id,
        name,
        subscription_status
      )
    `)
    .in('business_id', enabledBusinessIds)
    .eq('sms_consent', true)
    .eq('opted_out', false)
    .not('phone', 'is', null)
    .not('last_serviced_at', 'is', null);

  if (customersError) {
    console.error(
      '[Customer Reactivation] Could not load customers:',
      customersError.message
    );
    throw customersError;
  }

  // -------------------------------------------------------------
  // 3. Determine which candidates are actually due.
  // -------------------------------------------------------------
  const eligibleCustomers = (customers || []).filter((customer) => {
    const reactivationCount = customer.reactivation_count || 0;

    // Hard stop after MAX_REACTIVATIONS lifetime.
    if (reactivationCount >= MAX_REACTIVATIONS) {
      return false;
    }

    // Last service must be older than the threshold.
    if (!customer.last_serviced_at) {
      return false;
    }
    if (customer.last_serviced_at > serviceCutoff) {
      return false;
    }

    // If we've reactivated before, respect the cooldown.
    if (
      customer.last_reactivation_at &&
      customer.last_reactivation_at > cooldownCutoff
    ) {
      return false;
    }

    return true;
  });

  console.log(
    `[Customer Reactivation] ${eligibleCustomers.length} eligible customer(s) found.`
  );

  let sentCount = 0;

  // -------------------------------------------------------------
  // 4. Process eligible customers.
  // -------------------------------------------------------------
  for (const customer of eligibleCustomers) {
    const business = customer.businesses;

    if (!business) {
      console.log(
        `[Customer Reactivation] Skipping ${customer.id}: missing business.`
      );
      continue;
    }

    if (business.subscription_status !== 'active') {
      console.log(
        `[Customer Reactivation] Skipping ${customer.id}: subscription inactive.`
      );
      continue;
    }

    // Re-check the customer immediately before sending.
    // Guards against opt-outs or service updates that happened
    // after the initial query.
    const { data: freshCustomer, error: freshCustomerError } =
      await supabaseAdmin
        .from('customers')
        .select('opted_out, sms_consent, last_serviced_at, last_reactivation_at, reactivation_count')
        .eq('id', customer.id)
        .single();

    if (freshCustomerError || !freshCustomer) {
      console.log(
        `[Customer Reactivation] Skipping ${customer.id}: could not re-check customer.`
      );
      continue;
    }

    if (freshCustomer.opted_out || !freshCustomer.sms_consent) {
      console.log(
        `[Customer Reactivation] Skipping ${customer.id}: consent changed.`
      );
      continue;
    }

    const freshReactivationCount = freshCustomer.reactivation_count || 0;

    if (freshReactivationCount >= MAX_REACTIVATIONS) {
      console.log(
        `[Customer Reactivation] Skipping ${customer.id}: reactivation cap reached.`
      );
      continue;
    }

    if (
      freshCustomer.last_reactivation_at &&
      freshCustomer.last_reactivation_at > cooldownCutoff
    ) {
      console.log(
        `[Customer Reactivation] Skipping ${customer.id}: cooldown active.`
      );
      continue;
    }

    if (
      !freshCustomer.last_serviced_at ||
      freshCustomer.last_serviced_at > serviceCutoff
    ) {
      console.log(
        `[Customer Reactivation] Skipping ${customer.id}: last service is now too recent.`
      );
      continue;
    }

    // Calculate rough months since last service for a natural-sounding message.
    const daysSinceService = Math.floor(
      (Date.now() - new Date(freshCustomer.last_serviced_at).getTime()) /
      (24 * 60 * 60 * 1000)
    );
    const monthsSinceService = Math.max(3, Math.round(daysSinceService / 30));

    const messages = {
      en:
        `Hi ${customer.name}, it's ${business.name}. It's been about ` +
        `${monthsSinceService} months since we last helped you out — just ` +
        `checking in to see if you need anything. Reply STOP to opt out.`,

      es:
        `Hola ${customer.name}, le habla ${business.name}. Han pasado unos ` +
        `${monthsSinceService} meses desde nuestro último servicio — ` +
        `queríamos saber si necesita algo. Responda STOP para cancelar.`,
    };

    const language = (customer.language || 'en').toLowerCase().slice(0, 2);
    const message = messages[language] || messages.en;

    try {
      const twilioMessage = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: customer.phone,
      });

      const reactivatedAt = new Date().toISOString();

      // Record the successful reactivation.
      const { error: updateError } = await supabaseAdmin
        .from('customers')
        .update({
          last_reactivation_at: reactivatedAt,
          reactivation_count: freshReactivationCount + 1,
        })
        .eq('id', customer.id);

      if (updateError) {
        console.error(
          `[Customer Reactivation] SMS sent, but failed to record for ${customer.id}:`,
          updateError.message
        );
        continue;
      }

      sentCount += 1;

      console.log(
        `[Customer Reactivation] Reactivation sent for customer ${customer.id}. ` +
        `Reactivation ${freshReactivationCount + 1}/${MAX_REACTIVATIONS}. ` +
        `Twilio SID: ${twilioMessage.sid}`
      );
    } catch (error) {
      console.error(
        `[Customer Reactivation] Failed for customer ${customer.id}:`,
        error.message
      );
    }
  }

  console.log(
    `[Customer Reactivation] Run complete. ${sentCount} reactivation(s) sent.`
  );

  return {
    eligible: eligibleCustomers.length,
    sent: sentCount,
  };
}

module.exports = { runCustomerReactivation };

// Allows Railway to run this file directly during testing.
if (require.main === module) {
  runCustomerReactivation()
    .then((result) => {
      console.log('[Customer Reactivation] Finished:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Customer Reactivation] Fatal error:', error);
      process.exit(1);
    });
}
