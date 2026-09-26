const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Phone helpers (US-first, E.164 output).
// Will be extracted to server/lib/phone.js when Text Back also needs them.
// ---------------------------------------------------------------------------
function normalizePhoneE164(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;

  // Already E.164
  if (/^\+[1-9]\d{1,14}$/.test(str)) return str;

  // Strip everything non-digit
  const digits = str.replace(/\D/g, '');

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;

  return null; // caller treats null as invalid
}

function isValidE164(str) {
  return typeof str === 'string' && /^\+[1-9]\d{1,14}$/.test(str);
}

// ---------------------------------------------------------------------------
// Slug helper (unchanged)
// ---------------------------------------------------------------------------
async function generateSlug(name, supabase) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  let candidate = base;
  let suffix = 2;

  for (;;) {
    const { data } = await supabase
      .from('businesses')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();

    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix++;
  }
}

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

  const { data: existing, error: lookupError } = await req.supabase
    .from('businesses')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (lookupError) {
    return res.status(500).json({ error: lookupError.message });
  }

  if (existing) {
    return res.status(200).json({ business: existing });
  }

  const slug = await generateSlug(name, req.supabase);

  const { data, error } = await req.supabase
    .from('businesses')
    .insert({
      user_id: req.user.id,
      name,
      google_review_link: google_review_link || '',
      slug,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ business: data });
});

// PATCH /api/business - update business profile
//
// Accepts any subset of: name, google_review_link, phone, hot_lead_sms_enabled.
// Only fields present in the request body are written — this prevents one card's
// save from wiping the fields owned by another card.
router.patch('/', requireAuth, async (req, res) => {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
    if (typeof req.body.name !== 'string' || !req.body.name.trim()) {
      return res.status(400).json({ error: 'Business name cannot be empty' });
    }
    updates.name = req.body.name.trim();
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'google_review_link')) {
    updates.google_review_link = req.body.google_review_link || '';
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'phone')) {
    const raw = req.body.phone;
    if (raw === '' || raw === null) {
      updates.phone = null;
    } else {
      const normalized = normalizePhoneE164(raw);
      if (!normalized || !isValidE164(normalized)) {
        return res
          .status(400)
          .json({ error: 'Phone number is not valid. Use a US number like (559) 555-1234.' });
      }
      updates.phone = normalized;
    }
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'hot_lead_sms_enabled')) {
    if (typeof req.body.hot_lead_sms_enabled !== 'boolean') {
      return res
        .status(400)
        .json({ error: 'hot_lead_sms_enabled must be true or false' });
    }
    updates.hot_lead_sms_enabled = req.body.hot_lead_sms_enabled;
  }

  // Enforce the same invariant the UI enforces: alerts on requires a phone.
  // We check against the merged state (incoming update + current row) so a
  // partial save can't leave the account in a silent-failure state.
  if (updates.hot_lead_sms_enabled === true || updates.phone !== undefined) {
    const { data: current, error: currentErr } = await req.supabase
      .from('businesses')
      .select('phone, hot_lead_sms_enabled')
      .eq('user_id', req.user.id)
      .single();

    if (currentErr) return res.status(500).json({ error: currentErr.message });

    const mergedEnabled =
      updates.hot_lead_sms_enabled !== undefined
        ? updates.hot_lead_sms_enabled
        : current.hot_lead_sms_enabled;
    const mergedPhone =
      updates.phone !== undefined ? updates.phone : current.phone;

    if (mergedEnabled && !mergedPhone) {
      return res.status(400).json({
        error:
          'Add a phone number before turning on hot lead alerts, or leave alerts off.',
      });
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await req.supabase
    .from('businesses')
    .update(updates)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({ business: data });
});

module.exports = router;
