// GET /api/agent-settings — returns the authenticated user's agent config
// POST /api/agent-settings — updates the agent config (upsert)

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');

// GET /api/agent-settings
router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('user_id', req.user.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Agent not found' });
  res.json(data);
});

// POST /api/agent-settings
router.post('/', authenticate, async (req, res) => {
  const {
    name, business_name, services, service_area, tone, opening_message,
    owner_name, owner_phone,
    behavior,  // JSONB: intelligence flags + objections array
  } = req.body;

  // Update user profile fields if provided
  if (owner_name !== undefined || owner_phone !== undefined) {
    const userPayload = {};
    if (owner_name !== undefined) userPayload.name = owner_name;
    if (owner_phone !== undefined) userPayload.phone = owner_phone;
    await supabase.from('users').update(userPayload).eq('id', req.user.id);
  }

  // Build agent payload from provided fields only
  const payload = {};
  if (name !== undefined) payload.name = name;
  if (business_name !== undefined) payload.business_name = business_name;
  if (services !== undefined) payload.services = services;
  if (service_area !== undefined) payload.service_area = service_area;
  if (tone !== undefined) payload.tone = tone;
  if (opening_message !== undefined) payload.opening_message = opening_message;
  if (owner_phone !== undefined) payload.owner_phone = owner_phone;
  if (behavior !== undefined) payload.behavior = behavior;

  // Upsert: update if exists, create if not
  const { data: existing } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  let result;
  if (existing) {
    result = await supabase
      .from('agents')
      .update(payload)
      .eq('user_id', req.user.id)
      .select()
      .single();
  } else {
    result = await supabase
      .from('agents')
      .insert({ ...payload, user_id: req.user.id })
      .select()
      .single();
  }

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.json(result.data);
});

module.exports = router;
