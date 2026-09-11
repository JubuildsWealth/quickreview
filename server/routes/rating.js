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
// Compliant: every customer is offered the Google review link.
// We still save private feedback for lower ratings so the owner sees it.
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

  // Save the feedback for every rating so the owner has a record.
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

  // Detection: the customer responded, so mark their open review requests as
  // handled. This is the stop condition that prevents follow-ups from nagging
  // someone who already left a review. (Option B: close all open requests.)
  if (customer_id) {
    const { error: updateError } = await supabaseAdmin
      .from('review_requests')
      .update({ review_left: true })
      .eq('business_id', business.id)
      .eq('customer_id', customer_id)
      .eq('review_left', false);

    // Non-fatal: if this fails, the feedback is still saved and the customer
    // still gets their link. Worst case is one extra follow-up, never a broken
    // response. Log it but don't fail the request.
    if (updateError) {
      console.error('Failed to mark review_requests as reviewed:', updateError.message);
    }
  }

  // Everyone is offered the Google review link — no gating.
  res.json({
    google_review_link: business.google_review_link || null,
  });
});

module.exports = router;
