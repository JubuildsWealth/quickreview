require('dotenv').config();
const express = require('express');
const cors = require('cors');

const businessRoutes = require('./routes/business');
const customerRoutes = require('./routes/customers');
const smsRoutes = require('./routes/sms');
const stripeRoutes = require('./routes/stripe');

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe webhook needs raw body — mount before json middleware
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/business', businessRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/stripe', stripeRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`QuickReview server running on port ${PORT}`);
});
