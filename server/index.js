require('dotenv').config();
const express = require('express');
const cors = require('cors');

const businessRoutes = require('./routes/business');
const customerRoutes = require('./routes/customers');
const smsRoutes = require('./routes/sms');
const stripeRoutes = require('./routes/stripe');
const ratingRoutes = require('./routes/rating');
const invoiceRoutes = require('./routes/invoices');
const estimateRoutes = require('./routes/estimates');       // NEW
const feedbackRoutes = require('./routes/feedback');
const automationRoutes = require('./routes/automations');
const twilioWebhookRoutes = require('./routes/twilioWebhooks');
const dashboardRoutes = require('./routes/dashboard');      // NEW

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe webhook needs raw body — mount before json middleware
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Twilio webhooks send application/x-www-form-urlencoded, not JSON.
// Mount this parser BEFORE the JSON parser so Twilio requests parse right.
app.use('/api/twilio', express.urlencoded({ extended: false }));

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/business', businessRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/rating', ratingRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/estimates', estimateRoutes);                  // NEW
app.use('/api/feedback', feedbackRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/twilio', twilioWebhookRoutes);
app.use('/api/dashboard', dashboardRoutes);                 // NEW

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Arova API server running on port ${PORT}`);
});
