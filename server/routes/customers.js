const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers - list all customers for the business
router.get('/', requireAuth, async (req, res) => {
  const { data: business } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!business) return res.status(404).json({ error: 'Business not found' });

  const { data, error } = await req.supabase
    .from('customers')
    .select(`
      *,
      review_requests(id, sent_at, status)
    `)
    .eq('business_id', business.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ customers: data });
});

// POST /api/customers - add a new customer
router.post('/', requireAuth, async (req, res) => {
  const { name, phone, sms_consent } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }

  const { data: business } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!business) return res.status(404).json({ error: 'Business not found' });

  const { data, error } = await req.supabase
    .from('customers')
        .insert({
      business_id: business.id,
      name,
      phone,
      sms_consent: sms_consent === true,
      sms_consent_at: sms_consent === true ? new Date().toISOString() : null,
      consent_source: sms_consent === true ? 'added_by_business' : null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ customer: data });
});

// DELETE /api/customers/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const { data: business } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (!business) return res.status(404).json({ error: 'Business not found' });

  const { error } = await req.supabase
    .from('customers')
    .delete()
    .eq('id', req.params.id)
    .eq('business_id', business.id);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

module.exports = router;
