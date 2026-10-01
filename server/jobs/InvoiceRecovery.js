const twilio = require('twilio');
const { supabaseAdmin } = require('../lib/supabase');
const { normalizePhone } = require('../lib/phone');

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

async function flagForHumanAttention(invoiceId, reason) {
  const { error } = await supabaseAdmin
    .from('invoices')
    .update({
      needs_human_attention: true,
      attention_reason: reason,
    })
    .eq('id', invoiceId)
    .eq('status', 'unpaid');

  if (error) {
    console.error(
      `[Invoice Recovery] Failed to flag ${invoiceId} for human attention:`,
      error.message
    );
    return false;
  }

  return true;
}

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
      handed_off: 0,
    };
  }

  // -------------------------------------------------------------
  // 2. Load unpaid invoices for enabled businesses.
  //
  // IMPORTANT:
  // We intentionally DO NOT filter out reminder_count >= 3 here.
  // Those invoices need to enter the processing loop so Arova can
  // persist a followup_limit_reached human-attention handoff.
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
    .eq('status', 'unpaid');

  if (invoicesError) {
    console.error(
      '[Invoice Recovery] Could not load invoices:',
      invoicesError.message
    );
    throw invoicesError;
  }

  // -------------------------------------------------------------
  // 3. Determine which unpaid invoices need processing.
  //
  // An invoice is processable when:
  // - it has reached the reminder limit and needs handoff, OR
  // - its next reminder is due.
  //
  // Already-handed-off invoices are skipped so the hourly cron
  // doesn't repeatedly process the same terminal state.
  // -------------------------------------------------------------
  const eligibleInvoices = (invoices || []).filter((invoice) => {
    const reminderCount = invoice.reminder_count || 0;

    if (invoice.status === 'paid' || invoice.paid_at) {
      return false;
    }

    // Already handed off: nothing more for automation to do.
    if (invoice.needs_human_attention) {
      return false;
    }

    // Must enter the loop so we can persist the terminal handoff.
    if (reminderCount >= MAX_REMINDERS) {
      return true;
    }

    // Previously reminded: wait 3 days from the latest reminder.
    if (invoice.last_reminded_at) {
      return invoice.last_reminded_at <= cutoff;
    }

    // Never reminded: wait 3 days from invoice creation.
    return invoice.created_at <= cutoff;
  });

  console.log(
    `[Invoice Recovery] ${eligibleInvoices.length} eligible invoice(s) found.`
  );

  let sentCount = 0;
  let handedOffCount = 0;

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

    const toPhone = normalizePhone(customer.phone);

    if (!toPhone) {
      console.error(
        `[Invoice Recovery] Skipping ${invoice.id}: could not normalize customer phone ${customer.phone}.`
      );
      continue;
    }

    // -----------------------------------------------------------
    // 5. Fresh-state recheck immediately before any action.
    // -----------------------------------------------------------
    const { data: freshInvoice, error: freshInvoiceError } =
      await supabaseAdmin
        .from('invoices')
        .select(`
          id,
          business_id,
          customer_id,
          status,
          paid_at,
          reminder_count,
          last_reminded_at,
          needs_human_attention,
          attention_reason
        `)
        .eq('id', invoice.id)
        .single();

    if (freshInvoiceError || !freshInvoice) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: could not re-check invoice.`
      );
      continue;
    }

    if (freshInvoice.status !== 'unpaid' || freshInvoice.paid_at) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: invoice is no longer unpaid.`
      );
      continue;
    }

    // Another process/user may have already handed it off.
    if (freshInvoice.needs_human_attention) {
      console.log(
        `[Invoice Recovery] Skipping ${invoice.id}: already needs human attention.`
      );
      continue;
    }

    const freshReminderCount = freshInvoice.reminder_count || 0;

    // -----------------------------------------------------------
    // 6. Terminal branch: reminder limit reached.
    //
    // NO SMS. Persist the handoff instead.
    // -----------------------------------------------------------
    if (freshReminderCount >= MAX_REMINDERS) {
      const flagged = await flagForHumanAttention(
        invoice.id,
        'followup_limit_reached'
      );

      if (flagged) {
        handedOffCount += 1;

        console.log(
          `[Invoice Recovery] Handed off ${invoice.id}: ` +
          `reminder limit reached (${freshReminderCount}/${MAX_REMINDERS}).`
        );
      }

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

    // -----------------------------------------------------------
    // 7. Reply-stop branch.
    //
    // If the customer replied to THIS exact invoice after Arova's
    // most recent reminder, automation stops and hands the invoice
    // to a human.
    //
    // This relies on inbound Twilio reply linking:
    // related_type = 'invoice'
    // related_id   = invoice.id
    // -----------------------------------------------------------
    if (freshInvoice.last_reminded_at) {
      const { data: linkedReply, error: linkedReplyError } =
        await supabaseAdmin
          .from('sms_replies')
          .select('id, received_at')
          .eq('business_id', invoice.business_id)
          .eq('customer_id', invoice.customer_id)
          .eq('related_type', 'invoice')
          .eq('related_id', invoice.id)
          .gte('received_at', freshInvoice.last_reminded_at)
          .order('received_at', { ascending: false })
          .limit(1)
          .maybeSingle();

      if (linkedReplyError) {
        // Fail closed for customer experience:
        // if we cannot safely determine whether they replied,
        // do NOT send another automated collection message.
        console.error(
          `[Invoice Recovery] Could not check replies for ${invoice.id}:`,
          linkedReplyError.message
        );
        continue;
      }

      if (linkedReply) {
        const flagged = await flagForHumanAttention(
          invoice.id,
          'customer_replied'
        );

        if (flagged) {
          handedOffCount += 1;

          console.log(
            `[Invoice Recovery] Handed off ${invoice.id}: ` +
            `customer replied after latest reminder.`
          );
        }

        continue;
      }
    }

    // -----------------------------------------------------------
    // 8. No handoff condition exists. Send the next reminder.
    // -----------------------------------------------------------
    const amount = (invoice.amount_cents / 100).toFixed(2);

    const forPart = invoice.description
      ? ` for ${invoice.description}`
      : '';

    const payPart = invoice.payment_note
      ? ` ${invoice.payment_note}.`
      : '';

    const messages = {
      en:
        `Hi ${customer.name}, quick note from ${business.name} — ` +
        `showing a $${amount} balance${forPart}.` +
        payPart +
        ` If you've already paid, please disregard. Otherwise, thanks for taking care of it. ` +
        `Reply STOP to opt out.`,

      es:
        `Hola ${customer.name}, un aviso de ${business.name} — ` +
        `mostramos un saldo pendiente de $${amount}${forPart}.` +
        payPart +
        ` Si ya realizó el pago, ignore este mensaje. De lo contrario, gracias por atenderlo. ` +
        `Responda STOP para cancelar.`,
    };

    const message = messages[customer.language] || messages.en;

    try {
      const twilioMessage = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: toPhone,
      });

      const remindedAt = new Date().toISOString();

      // Log the outbound SMS.
      // source_id is critical because inbound replies use this
      // relationship to link back to the exact invoice.
      const { error: logError } = await supabaseAdmin
        .from('sms_outbound')
        .insert({
          business_id: invoice.business_id,
          customer_id: invoice.customer_id,
          to_phone: toPhone,
          body: message,
          twilio_sid: twilioMessage.sid,
          status: 'sent',
          source_type: 'invoice_reminder_auto',
          source_id: invoice.id,
        });

      if (logError) {
        console.error(
          `[Invoice Recovery] SMS sent, but failed to log to sms_outbound for ${invoice.id}:`,
          logError.message
        );
      }

      // Record successful reminder and make sure an invoice being
      // actively automated is not left with a stale handoff flag.
      const { error: updateError } = await supabaseAdmin
        .from('invoices')
        .update({
          last_reminded_at: remindedAt,
          reminder_count: freshReminderCount + 1,
          needs_human_attention: false,
          attention_reason: null,
        })
        .eq('id', invoice.id)
        .eq('status', 'unpaid');

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
    `[Invoice Recovery] Run complete. ` +
    `${sentCount} reminder(s) sent. ` +
    `${handedOffCount} invoice(s) handed to a human.`
  );

  return {
    eligible: eligibleInvoices.length,
    sent: sentCount,
    handed_off: handedOffCount,
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
