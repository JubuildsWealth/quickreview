const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// ---------------------------------------------------------------
// GET /api/customers - list all customers for the business
// ---------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  const { data: business } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { data, error } = await req.supabase
    .from('customers')
    .select(`
      *,
      review_requests(id, sent_at, status)
    `)
    .eq('business_id', business.id)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ customers: data });
});

// ---------------------------------------------------------------
// POST /api/customers - add a new customer
// ---------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  const { name, phone, sms_consent } = req.body;

  if (!name || !phone) {
    return res.status(400).json({
      error: 'Name and phone are required',
    });
  }

  const { data: business } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { data, error } = await req.supabase
    .from('customers')
    .insert({
      business_id: business.id,
      name,
      phone,
      sms_consent: sms_consent === true,
      sms_consent_at:
        sms_consent === true ? new Date().toISOString() : null,
      consent_source:
        sms_consent === true ? 'added_by_business' : null,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ customer: data });
});

// ---------------------------------------------------------------
// GET /api/customers/:id/activity
//
// Returns a normalized, newest-first activity timeline for one
// customer. This is intentionally read-only and assembled from
// existing Arova data rather than duplicating events into a new
// activity table.
//
// Timeline sources:
//   - review_requests
//   - estimates
//   - invoices
//   - sms_replies
//   - sms_outbound
//   - recovery_events
//
// Important:
// Estimates/invoices currently store only the latest reminder
// timestamp plus total reminder_count. We therefore show ONE
// reminder event representing the latest known follow-up and expose
// the total count. We do not invent historical reminder timestamps.
// ---------------------------------------------------------------
router.get('/:id/activity', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Resolve the authenticated user's business.
    const { data: business, error: businessError } = await req.supabase
      .from('businesses')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Verify this customer belongs to this business.
    const { data: customer, error: customerError } = await req.supabase
      .from('customers')
      .select('id, name, phone, language, created_at')
      .eq('id', id)
      .eq('business_id', business.id)
      .maybeSingle();

    if (customerError) {
      return res.status(500).json({ error: customerError.message });
    }

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Load all timeline sources in parallel.
    //
    // sms_replies / sms_outbound / recovery_events use supabaseAdmin
    // because existing Arova routes already access those tables this
    // way and their reads should still be scoped by business/customer.
    const [
      reviewResult,
      estimateResult,
      invoiceResult,
      replyResult,
      outboundResult,
      recoveryResult,
    ] = await Promise.all([
      req.supabase
        .from('review_requests')
        .select('id, sent_at, status')
        .eq('business_id', business.id)
        .eq('customer_id', customer.id),

      req.supabase
        .from('estimates')
        .select(`
          id,
          amount_cents,
          description,
          status,
          sent_at,
          last_reminded_at,
          reminder_count,
          accepted_at,
          declined_at,
          won_at,
          attributed_revenue_cents,
          attribution_source
        `)
        .eq('business_id', business.id)
        .eq('customer_id', customer.id),

      req.supabase
        .from('invoices')
        .select(`
          id,
          amount_cents,
          description,
          status,
          created_at,
          last_reminded_at,
          reminder_count,
          paid_at,
          attributed_recovered
        `)
        .eq('business_id', business.id)
        .eq('customer_id', customer.id),

      supabaseAdmin
        .from('sms_replies')
        .select(`
          id,
          body,
          received_at,
          is_hot_lead,
          hot_lead_keyword,
          handled_at
        `)
        .eq('business_id', business.id)
        .eq('customer_id', customer.id),

      supabaseAdmin
        .from('sms_outbound')
        .select(`
          id,
          body,
          status,
          created_at,
          related_sms_reply_id
        `)
        .eq('business_id', business.id)
        .eq('customer_id', customer.id),

      supabaseAdmin
        .from('recovery_events')
        .select(`
          id,
          source_type,
          source_id,
          amount_cents,
          reminder_count_at_recovery,
          description,
          recovered_at
        `)
        .eq('business_id', business.id)
        .eq('customer_id', customer.id),
    ]);

    const queryResults = [
      reviewResult,
      estimateResult,
      invoiceResult,
      replyResult,
      outboundResult,
      recoveryResult,
    ];

    const firstError = queryResults.find((result) => result.error);

    if (firstError?.error) {
      console.error(
        '[Customer Activity] Query failed:',
        firstError.error.message
      );

      return res.status(500).json({
        error: 'Failed to load customer activity',
      });
    }

    const reviews = reviewResult.data || [];
    const estimates = estimateResult.data || [];
    const invoices = invoiceResult.data || [];
    const replies = replyResult.data || [];
    const outbound = outboundResult.data || [];
    const recoveries = recoveryResult.data || [];

    const activity = [];

    // -------------------------------------------------------------
    // Customer created
    // -------------------------------------------------------------
    if (customer.created_at) {
      activity.push({
        id: `customer-created-${customer.id}`,
        type: 'customer_created',
        occurred_at: customer.created_at,
        title: 'Customer added',
        description: null,
        amount_cents: null,
        metadata: {},
      });
    }

    // -------------------------------------------------------------
    // Review requests
    // -------------------------------------------------------------
    for (const review of reviews) {
      if (!review.sent_at) continue;

      activity.push({
        id: `review-${review.id}`,
        type: 'review_request',
        occurred_at: review.sent_at,
        title: 'Review request sent',
        description: null,
        amount_cents: null,
        metadata: {
          status: review.status || null,
        },
      });
    }

    // -------------------------------------------------------------
    // Estimates
    // -------------------------------------------------------------
    for (const estimate of estimates) {
      // Estimate created / sent
      if (estimate.sent_at) {
        activity.push({
          id: `estimate-created-${estimate.id}`,
          type: 'estimate_created',
          occurred_at: estimate.sent_at,
          title: 'Estimate created',
          description: estimate.description || null,
          amount_cents: estimate.amount_cents || null,
          metadata: {
            estimate_id: estimate.id,
            status: estimate.status || null,
          },
        });
      }

      // Latest known estimate follow-up.
      if (
        estimate.last_reminded_at &&
        (estimate.reminder_count || 0) > 0
      ) {
        activity.push({
          id: `estimate-reminder-${estimate.id}`,
          type: 'estimate_reminder',
          occurred_at: estimate.last_reminded_at,
          title: 'Estimate follow-up sent',
          description: estimate.description || null,
          amount_cents: estimate.amount_cents || null,
          metadata: {
            estimate_id: estimate.id,
            reminder_count: estimate.reminder_count || 0,
          },
        });
      }

      // Declined estimate
      if (estimate.declined_at) {
        activity.push({
          id: `estimate-declined-${estimate.id}`,
          type: 'estimate_declined',
          occurred_at: estimate.declined_at,
          title: 'Estimate declined',
          description: estimate.description || null,
          amount_cents: estimate.amount_cents || null,
          metadata: {
            estimate_id: estimate.id,
          },
        });
      }

      // Won estimate.
      //
      // We intentionally do not also create a generic "accepted"
      // event when won_at exists because the current mark-won route
      // writes accepted_at and won_at at the same time. Showing both
      // would duplicate one real-world action in the timeline.
      if (estimate.won_at) {
        activity.push({
          id: `estimate-won-${estimate.id}`,
          type: 'estimate_won',
          occurred_at: estimate.won_at,
          title: 'Estimate won',
          description: estimate.description || null,
          amount_cents:
            estimate.attributed_revenue_cents ||
            estimate.amount_cents ||
            null,
          metadata: {
            estimate_id: estimate.id,
            attribution_source: estimate.attribution_source || null,
          },
        });
      } else if (estimate.accepted_at) {
        activity.push({
          id: `estimate-accepted-${estimate.id}`,
          type: 'estimate_accepted',
          occurred_at: estimate.accepted_at,
          title: 'Estimate accepted',
          description: estimate.description || null,
          amount_cents: estimate.amount_cents || null,
          metadata: {
            estimate_id: estimate.id,
          },
        });
      }
    }

    // -------------------------------------------------------------
    // Invoices
    // -------------------------------------------------------------
    for (const invoice of invoices) {
      // Invoice created
      if (invoice.created_at) {
        activity.push({
          id: `invoice-created-${invoice.id}`,
          type: 'invoice_created',
          occurred_at: invoice.created_at,
          title: 'Invoice created',
          description: invoice.description || null,
          amount_cents: invoice.amount_cents || null,
          metadata: {
            invoice_id: invoice.id,
            status: invoice.status || null,
          },
        });
      }

      // Latest known invoice reminder.
      if (
        invoice.last_reminded_at &&
        (invoice.reminder_count || 0) > 0
      ) {
        activity.push({
          id: `invoice-reminder-${invoice.id}`,
          type: 'invoice_reminder',
          occurred_at: invoice.last_reminded_at,
          title: 'Invoice reminder sent',
          description: invoice.description || null,
          amount_cents: invoice.amount_cents || null,
          metadata: {
            invoice_id: invoice.id,
            reminder_count: invoice.reminder_count || 0,
          },
        });
      }

      // Invoice paid
      if (invoice.paid_at) {
        activity.push({
          id: `invoice-paid-${invoice.id}`,
          type: 'invoice_paid',
          occurred_at: invoice.paid_at,
          title: 'Invoice paid',
          description: invoice.description || null,
          amount_cents: invoice.amount_cents || null,
          metadata: {
            invoice_id: invoice.id,
            attributed_recovered:
              invoice.attributed_recovered === true,
          },
        });
      }
    }

    // -------------------------------------------------------------
    // Inbound SMS replies
    // -------------------------------------------------------------
    for (const reply of replies) {
      if (!reply.received_at) continue;

      activity.push({
        id: `sms-reply-${reply.id}`,
        type: 'customer_reply',
        occurred_at: reply.received_at,
        title: 'Customer replied',
        description: reply.body || null,
        amount_cents: null,
        metadata: {
          sms_reply_id: reply.id,
          is_hot_lead: reply.is_hot_lead === true,
          hot_lead_keyword: reply.hot_lead_keyword || null,
          handled_at: reply.handled_at || null,
        },
      });

      // handled_at is a separate real action and has its own timestamp.
      if (reply.handled_at) {
        activity.push({
          id: `hot-lead-handled-${reply.id}`,
          type: 'hot_lead_handled',
          occurred_at: reply.handled_at,
          title: 'Lead marked handled',
          description: null,
          amount_cents: null,
          metadata: {
            sms_reply_id: reply.id,
          },
        });
      }
    }

    // -------------------------------------------------------------
    // Owner outbound replies
    // -------------------------------------------------------------
    for (const message of outbound) {
      if (!message.created_at) continue;

      activity.push({
        id: `sms-outbound-${message.id}`,
        type: 'business_reply',
        occurred_at: message.created_at,
        title: 'Reply sent',
        description: message.body || null,
        amount_cents: null,
        metadata: {
          sms_outbound_id: message.id,
          status: message.status || null,
          related_sms_reply_id:
            message.related_sms_reply_id || null,
        },
      });
    }

    // -------------------------------------------------------------
    // Arova-attributed recovery events
    //
    // These are intentionally separate from "invoice paid" /
    // "estimate won". The underlying state change says what happened;
    // the recovery event says Arova can honestly take attribution.
    // -------------------------------------------------------------
    for (const recovery of recoveries) {
      if (!recovery.recovered_at) continue;

      activity.push({
        id: `recovery-${recovery.id}`,
        type: 'recovery',
        occurred_at: recovery.recovered_at,
        title: 'Revenue recovered by Arova',
        description: recovery.description || null,
        amount_cents: recovery.amount_cents || null,
        metadata: {
          recovery_event_id: recovery.id,
          source_type: recovery.source_type,
          source_id: recovery.source_id,
          reminder_count:
            recovery.reminder_count_at_recovery || 0,
        },
      });
    }

    // Newest activity first.
    activity.sort((a, b) => {
      return (
        new Date(b.occurred_at).getTime() -
        new Date(a.occurred_at).getTime()
      );
    });

    return res.json({
      customer,
      activity,
      count: activity.length,
    });
  } catch (err) {
    console.error('[Customer Activity] Error:', err.message);

    return res.status(500).json({
      error: 'Failed to load customer activity',
    });
  }
});

// ---------------------------------------------------------------
// DELETE /api/customers/:id
// ---------------------------------------------------------------
router.delete('/:id', requireAuth, async (req, res) => {
  const { data: business } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { error } = await req.supabase
    .from('customers')
    .delete()
    .eq('id', req.params.id)
    .eq('business_id', business.id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
});

module.exports = router;
