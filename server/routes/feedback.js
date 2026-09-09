const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/feedback - list all feedback for the logged-in business
router.get('/', requireAuth, async (req, res) => {
  const { data: business, error: bizError } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (bizError || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { data, error } = await req.supabase
    .from('feedback')
    .select('id, rating, comment, created_at, customer_id')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  res.json({ feedback: data });
});

module.exports = router;
