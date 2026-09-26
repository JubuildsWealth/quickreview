require('dotenv').config();

const express = require('express');
const cors = require('cors');

const businessRoutes = require('./routes/business');
const customerRoutes = require('./routes/customers');
const smsRoutes = require('./routes/sms');
const stripeRoutes = require('./routes/stripe');
const ratingRoutes = require('./routes/rating');
const invoiceRoutes = require('./routes/invoices');
const estimateRoutes = require('./routes/estimates');
const feedbackRoutes = require('./routes/feedback');
const automationRoutes = require('./routes/automations');
const twilioWebhookRoutes = require('./routes/twilioWebhooks');
const dashboardRoutes = require('./routes/dashboard');
const opportunityRoutes = require('./routes/opportunities');
const recoveryRoutes = require('./routes/recovery');
const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// PROXY CONFIGURATION
// Railway runs the Express server behind a reverse proxy.
// Trust the first proxy so Express can correctly understand the original
// protocol/IP information forwarded by Railway.
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// STRIPE WEBHOOK BODY
// Stripe signature verification requires the raw request body.
// This MUST remain before express.json().
// ---------------------------------------------------------------------------
app.use(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' })
);

// ---------------------------------------------------------------------------
// TWILIO WEBHOOK BODY PARSING
// Twilio sends webhook payloads as application/x-www-form-urlencoded.
//
// /api/twilio/* handles the existing Twilio webhook routes.
// /api/sms/inbound handles inbound customer SMS replies.
// These parsers MUST run before express.json().
// ---------------------------------------------------------------------------
app.use(
  '/api/twilio',
  express.urlencoded({ extended: false })
);

app.use(
  '/api/sms/inbound',
  express.urlencoded({ extended: false })
);

// ---------------------------------------------------------------------------
// GENERAL MIDDLEWARE
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
  })
);

app.use(express.json());

// ---------------------------------------------------------------------------
// API ROUTES
// ---------------------------------------------------------------------------
app.use('/api/business', businessRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/rating', ratingRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/estimates', estimateRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/twilio', twilioWebhookRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/opportunities', opportunityRoutes);
app.use('/api/recovery', recoveryRoutes);
// ---------------------------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Arova API server running on port ${PORT}`);
});
