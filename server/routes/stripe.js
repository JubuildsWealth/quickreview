const express = require('express');
const Stripe = require('stripe');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /api/stripe/checkout - create a Stripe Checkout session
router.post('/checkout', requireAuth, async (req, res) => {
  const { data: business, error: businessError } = await supabaseAdmin
    .from('businesses')
    .select('id, name, stripe_customer_id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (businessError) {
    console.error('Stripe business lookup failed:', businessError);
    return res.status(500).json({ error: businessError.message });
  }

  if (!business) {
    console.error('No business for authenticated user:', req.user.id);
    return res.status(404).json({ error: 'Business not found' });
  }

  let customerId = business.stripe_customer_id;

  // Create a Stripe customer if one doesn't exist
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: req.user.email,
      name: business.name,
      metadata: {
        business_id: business.id,
        user_id: req.user.id,
      },
    });

    customerId = customer.id;

    const { error: updateError } = await supabaseAdmin
      .from('businesses')
      .update({ stripe_customer_id: customerId })
      .eq('id', business.id);

    if (updateError) {
      console.error('Failed to save Stripe customer ID:', updateError);
      return res.status(500).json({ error: updateError.message });
    }
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'QuickReview Pro',
            description:
              'Unlimited SMS review requests — grow your Google reviews on autopilot',
          },
          unit_amount: 9700,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    success_url: `${process.env.CLIENT_URL}/dashboard?subscribed=true`,
    cancel_url: `${process.env.CLIENT_URL}/subscribe`,
    metadata: {
      business_id: business.id,
    },
  });

  res.json({ url: session.url });
});

// POST /api/stripe/portal - create a billing portal session
router.post('/portal', requireAuth, async (req, res) => {
  const { data: business, error: businessError } = await supabaseAdmin
    .from('businesses')
    .select('stripe_customer_id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (businessError) {
    console.error('Billing portal business lookup failed:', businessError);
    return res.status(500).json({ error: businessError.message });
  }

  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  if (!business.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: business.stripe_customer_id,
    return_url: `${process.env.CLIENT_URL}/dashboard`,
  });

  res.json({ url: session.url });
});

// POST /api/stripe/webhook - handle Stripe events
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      if (webhookSecret) {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          webhookSecret
        );
      } else {
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      return res.status(400).json({
        error: `Webhook error: ${err.message}`,
      });
    }

    // Helper: extract the customer ID whether it's a string or an object
    const getCustomerId = (subscription) =>
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;

    // Sync a subscription's CURRENT state from Stripe into Supabase.
    // We deliberately re-fetch the subscription from Stripe instead of
    // trusting event.data.object.status, because 'created' (incomplete)
    // and 'updated' (active) events can arrive out of order — trusting
    // the payload lets a stale 'incomplete' overwrite a fresh 'active'.
    const syncSubscription = async (subscriptionId, customerId) => {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      const { error } = await supabaseAdmin
        .from('businesses')
        .update({
          subscription_status: subscription.status,
          stripe_subscription_id: subscription.id,
        })
        .eq('stripe_customer_id', customerId);

      if (error) {
        console.error('Failed to sync subscription to Supabase:', error);
      }
    };

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const sub = event.data.object;
          await syncSubscription(sub.id, getCustomerId(sub));
          break;
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object;
          const { error } = await supabaseAdmin
            .from('businesses')
            .update({
              subscription_status: 'canceled',
              stripe_subscription_id: sub.id,
            })
            .eq('stripe_customer_id', getCustomerId(sub));

          if (error) {
            console.error('Failed to mark subscription canceled:', error);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const { error } = await supabaseAdmin
            .from('businesses')
            .update({ subscription_status: 'past_due' })
            .eq('stripe_customer_id', event.data.object.customer);

          if (error) {
            console.error('Failed to mark subscription past_due:', error);
          }
          break;
        }
      }
    } catch (err) {
      console.error('Webhook handler error:', err);
      // Still return 200 so Stripe doesn't retry endlessly on a bug we
      // need to fix in code; the error is logged above for debugging.
    }

    res.json({ received: true });
  }
);

module.exports = router;
