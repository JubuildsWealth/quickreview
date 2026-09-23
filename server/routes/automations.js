const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_SETTINGS = {
  review_followup_enabled: false,
  invoice_recovery_enabled: false,
  missed_call_enabled: false,
  estimate_followup_enabled: false,
  reactivation_enabled: false,
};

const ALLOWED_SETTINGS = new Set(Object.keys(DEFAULT_SETTINGS));

// GET /api/automations
// Return this business's automation settings.
// If no row exists yet, create one with every automation OFF.
router.get('/', requireAuth, async (req, res) => {
  const { data: business, error: businessError } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (businessError || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  let { data: settings, error } = await req.supabase
    .from('automation_settings')
    .select('*')
    .eq('business_id', business.id)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!settings) {
    const result = await req.supabase
      .from('automation_settings')
      .insert({
        business_id: business.id,
        ...DEFAULT_SETTINGS,
      })
      .select()
      .single();

    if (result.error) {
      return res.status(500).json({ error: result.error.message });
    }

    settings = result.data;
  }

  res.json({ settings });
});

// PATCH /api/automations
// Update one or more automation switches for this business.
router.patch('/', requireAuth, async (req, res) => {
  const updates = {};

  for (const [key, value] of Object.entries(req.body || {})) {
    if (!ALLOWED_SETTINGS.has(key)) continue;

    if (typeof value !== 'boolean') {
      return res.status(400).json({
        error: `${key} must be true or false`,
      });
    }

    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      error: 'No valid automation settings provided',
    });
  }

  const { data: business, error: businessError } = await req.supabase
    .from('businesses')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  if (businessError || !business) {
    return res.status(404).json({ error: 'Business not found' });
  }

  const { data: settings, error } = await req.supabase
    .from('automation_settings')
    .upsert(
      {
        business_id: business.id,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'business_id' }
    )
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ settings });
});

module.exports = router;
