const twilio = require('twilio');
const { supabaseAdmin } = require('../lib/supabase');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Production V1:
// First reminder after 3 days.
// Additional reminders must also be at least 3 days apart.
// Never send more than 3 automatic reminders.
const REMINDER_DELAY_DAYS = 3;
const MAX_REMINDERS = 3;

async function runInvoiceRecovery() {
  console.log('[Invoice Recovery] Starting run...');

  const cutoff = new Date(
    Date.now() - REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // -------------------------------------------------------------
  // 1. Find businesses that explicitly enabled Invoice Recovery.
  // -------------------------------------------------------------
  const { data: enabledSettings, error: settingsError } =
    await supabaseAdmin
      .from('automation_settings')
      .select('business_id')
      .eq('invoice_recovery_enabled', true);

  if (settingsError) {
    console.error(
      '[Invoice Recovery] Could not load automation settings:',
      settingsError.message
    );
    throw settingsError;
  }

  const enabledBusinessIds = (enabledSettings || []).map(
    (setting) => setting.business_id
  );

  if (enabledBusinessIds.length === 0) {
    console.log(
      '[Invoice Recovery] No businesses have this automation enabled.'
    );

    return {
      eligible: 0,
      sent: 0,
    };
  }

  // -------------------------------------------------------------
  // 2. Find unpaid invoices belonging to enabled businesses.
  //
  // We intentionally do some timing checks again below in JS:
  // - brand-new invoices must be at least 3 days old
  // - previously reminded invoices must have waited another 3 days
  // - invoices with 3 reminders are finished
  // -------------------------------------------------------------
  const { data: invoices, error: invoicesError } = await supabaseAdmin
    .from('invoices')
    .select(`
      id,
      business_id,
      customer_id,
      amount_cents,
      description,
      payment_note,
      status,
      created_at,
      paid_at,
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
    .neq('status', 'paid');

  if (invoicesError) {
    console.error(
      '[Invoice Recovery] Could not load invoices:',
      invoicesError.message
    );
    throw invoicesError;
  }

  // -------------------------------------------------------------
  // 3. Determine which unpaid invoices are actually due.
  // -------------------------------------------------------------
  const eligibleInvoices = (invoices || []).filter((invoice) => {
    const reminderCount = invoice.reminder_count || 0;

    // Hard stop after 3 automatic reminders.
    if (reminderCount >= MAX_REMINDERS) {
      return false;
    }

    // Extra paid safety check.
    if (invoice.status === 'paid' || invoice.paid_at) {
      return false;
    }

    // If we've already reminded them, wait 3 days from the
    // most recent reminder.
    if (invoice.last_reminded_at) {
      return invoice.last_reminded_at <= cutoff;
    }

    // Otherwise wait 3 days from invoice creation.
    return invoice.created_at <= cutoff;
  });

  console.log(
    `[Invoice Recovery] ${eligibleInvoices.length} eligible invoice(s) found.`
  );

  let sentCount = 0;

  // -------------------------------------------------------------
  // 4. Process eligible invoices.
  // -------------------------------------------------------------
  for (const invoice of eligibleInvoices) {
    const customer = invoice.customers;
    const business = invoice.businesses;

    // Safety gates.
    if (!customer || !business) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: missing customer or business.`
      );
      continue;
    }

    if (business.subscription_status !== 'active') {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: subscription inactive.`
      );
      continue;
    }

    if (!customer.sms_consent) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: no SMS consent.`
      );
      continue;
    }

    if (customer.opted_out) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: customer opted out.`
      );
      continue;
    }

    if (!customer.phone) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: no phone number.`
      );
      continue;
    }

    // Re-check the invoice immediately before sending.
    // This reduces the chance of reminding someone whose invoice
    // was marked paid after the initial query.
    const { data: freshInvoice, error: freshInvoiceError } =
      await supabaseAdmin
        .from('invoices')
        .select('status, paid_at, reminder_count, last_reminded_at')
        .eq('id', invoice.id)
        .single();

    if (freshInvoiceError || !freshInvoice) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: could not re-check invoice.`
      );
      continue;
    }

    if (freshInvoice.status === 'paid' || freshInvoice.paid_at) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: invoice is now paid.`
      );
      continue;
    }

    const freshReminderCount = freshInvoice.reminder_count || 0;

    if (freshReminderCount >= MAX_REMINDERS) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: reminder limit reached.`
      );
      continue;
    }

    // Re-check timing using the freshest row.
    if (
      freshInvoice.last_reminded_at &&
      freshInvoice.last_reminded_at > cutoff
    ) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: reminded too recently.`
      );
      continue;
    }

    const amount = (invoice.amount_cents / 100).toFixed(2);

    const forPart = invoice.description
      ? ` for ${invoice.description}`
      : '';

    const payPart = invoice.payment_note
      ? ` ${invoice.payment_note}.`
      : '';

    const messages = {
      en:
        `Hi ${customer.name}, a friendly reminder from ${business.name}: ` +
        `you have a balance of $${amount}${forPart}.` +
        payPart +
        ` Reply STOP to opt out.`,

      es:
        `Hola ${customer.name}, un recordatorio amistoso de ${business.name}: ` +
        `tiene un saldo pendiente de $${amount}${forPart}.` +
        payPart +
        ` Responda STOP para cancelar.`,
    };

    const message = messages[customer.language] || messages.en;

    try {
      const twilioMessage = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: customer.phone,
      });

      const remindedAt = new Date().toISOString();

      // Record the successful reminder.
      const { error: updateError } = await supabaseAdmin
        .from('invoices')
        .update({
          last_reminded_at: remindedAt,
          reminder_count: freshReminderCount + 1,
        })
        .eq('id', invoice.id)
        .neq('status', 'paid');

      if (updateError) {
        console.error(
          `[Invoice Recovery] SMS sent, but failed to record reminder for ${invoice.id}:`,
          updateError.message
        );
        continue;
      }

      sentCount += 1;

      console.log(
        `[Invoice Recovery] Reminder sent for invoice ${invoice.id}. ` +
        `Reminder ${freshReminderCount + 1}/${MAX_REMINDERS}. ` +
        `Twilio SID: ${twilioMessage.sid}`
      );
    } catch (error) {
      console.error(
        `[Invoice Recovery] Failed for invoice ${invoice.id}:`,
        error.message
      );
    }
  }

  console.log(
    `[Invoice Recovery] Run complete. ${sentCount} reminder(s) sent.`
  );

  return {
    eligible: eligibleInvoices.length,
    sent: sentCount,
  };
}

module.exports = { runInvoiceRecovery };

// Allows Railway to run this file directly during testing.
if (require.main === module) {
  runInvoiceRecovery()
    .then((result) => {
      console.log('[Invoice Recovery] Finished:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Invoice Recovery] Fatal error:', error);
      process.exit(1);
    });
}
