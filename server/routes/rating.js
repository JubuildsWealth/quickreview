const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// GET /api/rating/:businessId
// Public — returns the info the rating page needs to render.
router.get('/:businessId', async (req, res) => {
  const { businessId } = req.params;

  const { data: business, error } = await supabaseAdmin
    .from('businesses')
    .select('id, name, google_review_link')
    .eq('id', businessId)
    .single();

  if (error || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  res.json({
    business: {
      id: business.id,
      name: business.name,
      google_review_link: business.google_review_link,
    },
  });
});

// POST /api/rating/:businessId
// 4-5 -> return the Google link (send them public).
// 1-3 -> save private feedback (keep it off Google).
router.post('/:businessId', async (req, res) => {
  const { businessId } = req.params;
  const { rating, comment, customer_id } = req.body;

  const score = parseInt(rating, 10);
  if (!score || score < 1 || score > 5) {
    return res.status(400).json({ error: 'A rating between 1 and 5 is required.' });
  }

  const { data: business, error: bizError } = await supabaseAdmin
    .from('businesses')
    .select('id, name, google_review_link')
    .eq('id', businessId)
    .single();

  if (bizError || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  // Happy customer (4-5): send them to Google.
  if (score >= 4) {
    return res.json({
      route: 'google',
      google_review_link:
        business.google_review_link ||
        'https://www.google.com/search?q=' + encodeURIComponent(business.name),
    });
  }

  // Unhappy customer (1-3): keep it private, save the feedback.
  const { error: fbError } = await supabaseAdmin
    .from('feedback')
    .insert({
      business_id: business.id,
      customer_id: customer_id || null,
      rating: score,
      comment: comment || null,
    });

  if (fbError) {
    return res.status(500).json({ error: fbError.message });
  }

  res.json({ route: 'private', message: 'Thank you for your feedback.' });
});

module.exports = router;
