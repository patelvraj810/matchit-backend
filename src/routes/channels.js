// Channel management — which communication channels the business has active
// GET    /api/channels         — list enabled channels for user
// POST   /api/channels         — enable/configure a channel
// DELETE /api/channels/:type   — disable a channel

// Channels are stored as a JSONB array in the agents.channels column.
// Supported channel types: 'whatsapp', 'sms', 'email', 'instagram', 'facebook', 'webchat'
// Each channel object: { type, enabled, config: { phone?, username?, webhook_url? }, created_at }

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');

// Helper: get or initialise the agent row for a user
async function getAgentRow(userId) {
  const { data } = await supabase
    .from('agents')
    .select('id, channels')
    .eq('user_id', userId)
    .single();
  return data;
}

// GET /api/channels
router.get('/', authenticate, async (req, res) => {
  const agent = await getAgentRow(req.user.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found — configure your agent first' });
  res.json(agent.channels || []);
});

// POST /api/channels
router.post('/', authenticate, async (req, res) => {
  const { type, enabled = true, config = {} } = req.body;

  const supportedTypes = ['whatsapp', 'sms', 'email', 'instagram', 'facebook', 'webchat'];
  if (!type || !supportedTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${supportedTypes.join(', ')}` });
  }

  const agent = await getAgentRow(req.user.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found — configure your agent first' });

  const channels = agent.channels || [];

  // Replace existing channel of same type or add new
  const existingIndex = channels.findIndex(c => c.type === type);
  const channelEntry = {
    type,
    enabled,
    config,
    created_at: existingIndex >= 0
      ? channels[existingIndex].created_at
      : new Date().toISOString()
  };

  if (existingIndex >= 0) {
    channels[existingIndex] = channelEntry;
  } else {
    channels.push(channelEntry);
  }

  const { data, error } = await supabase
    .from('agents')
    .update({ channels })
    .eq('user_id', req.user.id)
    .select('channels')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.channels);
});

// DELETE /api/channels/:type
router.delete('/:type', authenticate, async (req, res) => {
  const { type } = req.params;

  const agent = await getAgentRow(req.user.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const channels = (agent.channels || []).filter(c => c.type !== type);

  const { data, error } = await supabase
    .from('agents')
    .update({ channels })
    .eq('user_id', req.user.id)
    .select('channels')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.channels);
});

module.exports = router;
