// GET /api/agent-settings — returns the authenticated user's agent config
// POST /api/agent-settings — updates the agent config

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
  const { name, business_name, services, service_area, tone, opening_message } = req.body;

  // Upsert: update if exists, create if not
  const { data: existing } = await supabase
    .from('agents')
    .select('id')
    .eq('user_id', req.user.id)
    .single();

  const payload = {};
  if (name !== undefined) payload.name = name;
  if (business_name !== undefined) payload.business_name = business_name;
  if (services !== undefined) payload.services = services;
  if (service_area !== undefined) payload.service_area = service_area;
  if (tone !== undefined) payload.tone = tone;
  if (opening_message !== undefined) payload.opening_message = opening_message;

  let result;
  if (existing) {
    result = await supabase.from('agents').update(payload).eq('user_id', req.user.id).select().single();
  } else {
    result = await supabase.from('agents').insert({ ...payload, user_id: req.user.id }).select().single();
  }

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.json(result.data);
});

module.exports = router;
