// Integrations
// GET   /api/integrations           — list connected integrations for this workspace
// POST  /api/integrations/seed      — detect env-based connections and upsert initial state
// PATCH /api/integrations/:provider — update connection metadata (label, config, status)
// DELETE /api/integrations/:provider — disconnect (set status = disconnected)

const express = require('express');
const router  = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase     = require('../lib/db');

// Providers the system can auto-detect from env vars at server start
const ENV_DETECTED_PROVIDERS = [
  {
    provider:        'stripe',
    label:           'Stripe',
    connection_type: 'api_key',
    detect:          () => !!(process.env.STRIPE_SECRET_KEY),
    account_label:   () => process.env.STRIPE_SECRET_KEY ? 'Live key configured' : null,
  },
  {
    provider:        'whatsapp',
    label:           'WhatsApp Business',
    connection_type: 'env',
    detect:          () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
    account_label:   () => process.env.WHATSAPP_PHONE_ID ? `Phone ID: ${process.env.WHATSAPP_PHONE_ID}` : null,
  },
  {
    provider:        'twilio',
    label:           'Twilio SMS/WhatsApp',
    connection_type: 'api_key',
    detect:          () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    account_label:   () => process.env.TWILIO_ACCOUNT_SID ? `SID: ${process.env.TWILIO_ACCOUNT_SID.slice(0, 8)}…` : null,
  },
  {
    provider:        'resend',
    label:           'Resend Email',
    connection_type: 'api_key',
    detect:          () => !!(process.env.RESEND_API_KEY),
    account_label:   () => process.env.RESEND_API_KEY ? 'API key configured' : null,
  },
  {
    provider:        'gemini',
    label:           'Google Gemini AI',
    connection_type: 'api_key',
    detect:          () => !!(process.env.GEMINI_API_KEY),
    account_label:   () => process.env.GEMINI_API_KEY ? 'Flash-Lite model active' : null,
  },
];

// GET /api/integrations
router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('connected_integrations')
    .select('*')
    .eq('user_id', req.user.id)
    .order('provider');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/integrations/seed
// Called on first load to detect env-based connections and populate DB.
// Safe to call repeatedly — uses upsert with onConflict(user_id, provider).
router.post('/seed', authenticate, async (req, res) => {
  const now = new Date().toISOString();
  const rows = ENV_DETECTED_PROVIDERS.map(p => ({
    user_id:         req.user.id,
    provider:        p.provider,
    status:          p.detect() ? 'connected' : 'disconnected',
    connection_type: p.connection_type,
    account_label:   p.account_label() || null,
    last_sync_at:    p.detect() ? now : null,
    error_message:   null,
    updated_at:      now,
  }));

  const { data, error } = await supabase
    .from('connected_integrations')
    .upsert(rows, { onConflict: 'user_id,provider', ignoreDuplicates: false })
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PATCH /api/integrations/:provider
// Update connection metadata — account label, config, status
router.patch('/:provider', authenticate, async (req, res) => {
  const { provider } = req.params;
  const allowed = ['status', 'account_label', 'config', 'error_message'];
  const payload = { updated_at: new Date().toISOString() };

  for (const key of allowed) {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  }

  if (payload.status === 'connected') payload.last_sync_at = new Date().toISOString();

  // Upsert so providers that weren't seeded can still be updated
  const { data, error } = await supabase
    .from('connected_integrations')
    .upsert(
      { user_id: req.user.id, provider, ...payload },
      { onConflict: 'user_id,provider' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/integrations/:provider — soft disconnect
router.delete('/:provider', authenticate, async (req, res) => {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('connected_integrations')
    .update({ status: 'disconnected', account_label: null, config: {}, updated_at: now })
    .eq('user_id', req.user.id)
    .eq('provider', req.params.provider)
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Integration not found' });
  res.json({ success: true });
});

module.exports = router;
