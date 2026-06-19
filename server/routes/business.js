const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/business - fetch the current user's business profile
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await req.supabase
    .from('businesses')
    .select('*')
    .eq('user_id', req.user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }

  res.json({ business: data || null });
});

// POST /api/business - create business profile (onboarding)
router.post('/', requireAuth, async (req, res) => {
  const { name, google_review_link } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Business name is required' });
  }

  const { data, error } = await req.supabase
    .from('businesses')
    .insert({
      user_id: req.user.id,
      name,
      google_review_link: google_review_link || '',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ business: data });
});

// PATCH /api/business - update business profile
router.patch('/', requireAuth, async (req, res) => {
  const { name, google_review_link } = req.body;

  const { data, error } = await req.supabase
    .from('businesses')
    .update({ name, google_review_link })
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({ business: data });
});

module.exports = router;
