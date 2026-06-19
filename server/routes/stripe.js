const express = require('express');
const Stripe = require('stripe');
const { requireAuth } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /api/stripe/checkout - create a Stripe Checkout session
router.post('/checkout', requireAuth, async (req, res) => {
  const { data: business } = await req.supabase
    .from('businesses')
    .select('id, name, stripe_customer_id')
    .eq('user_id', req.user.id)
    .single();

  if (!business) return res.status(404).json({ error: 'Business not found' });

  let customerId = business.stripe_customer_id;

  // Create a Stripe customer if one doesn't exist
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: req.user.email,
      name: business.name,
      metadata: { business_id: business.id, user_id: req.user.id },
    });
    customerId = customer.id;

    await req.supabase
      .from('businesses')
      .update({ stripe_customer_id: customerId })
      .eq('id', business.id);
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
            description: 'Unlimited SMS review requests — grow your Google reviews on autopilot',
          },
          unit_amount: 9700,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    success_url: `${process.env.CLIENT_URL}/dashboard?subscribed=true`,
    cancel_url: `${process.env.CLIENT_URL}/subscribe`,
    metadata: { business_id: business.id },
  });

  res.json({ url: session.url });
});

// POST /api/stripe/portal - create a billing portal session
router.post('/portal', requireAuth, async (req, res) => {
  const { data: business } = await req.supabase
    .from('businesses')
    .select('stripe_customer_id')
    .eq('user_id', req.user.id)
    .single();

  if (!business?.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: business.stripe_customer_id,
    return_url: `${process.env.CLIENT_URL}/dashboard`,
  });

  res.json({ url: session.url });
});

// POST /api/stripe/webhook - handle Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const updateSubscriptionStatus = async (subscription, status) => {
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

    await supabaseAdmin
      .from('businesses')
      .update({
        subscription_status: status,
        stripe_subscription_id: subscription.id,
      })
      .eq('stripe_customer_id', customerId);
  };

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await updateSubscriptionStatus(event.data.object, event.data.object.status);
      break;
    case 'customer.subscription.deleted':
      await updateSubscriptionStatus(event.data.object, 'canceled');
      break;
    case 'invoice.payment_failed':
      await supabaseAdmin
        .from('businesses')
        .update({ subscription_status: 'past_due' })
        .eq('stripe_customer_id', event.data.object.customer);
      break;
  }

  res.json({ received: true });
});

module.exports = router;
