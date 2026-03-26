// Campaigns Routes
// GET    /api/campaigns                  — list campaigns (supports ?status=)
// POST   /api/campaigns                  — create campaign
// PATCH  /api/campaigns/:id              — update campaign
// DELETE /api/campaigns/:id              — delete campaign
// POST   /api/campaigns/:id/activate     — set status to active
// POST   /api/campaigns/:id/pause        — set status to paused
// GET    /api/campaigns/:id/runs         — execution history for a campaign
// POST   /api/campaigns/:id/trigger      — manually trigger campaign for a recipient

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');
const { triggerCampaignManually } = require('../services/campaignRunner');

const VALID_TYPES    = ['review_request', 'stale_lead', 'quote_followup', 'post_job'];
const VALID_CHANNELS = ['whatsapp', 'email', 'sms'];
const VALID_STATUSES = ['draft', 'active', 'paused', 'archived'];

// GET /api/campaigns
router.get('/', authenticate, async (req, res) => {
  const { status } = req.query;
  let query = supabase
    .from('campaigns')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/campaigns
router.post('/', authenticate, async (req, res) => {
  const {
    name, type, channel = 'whatsapp', status = 'draft',
    target_segment = 'all', message_template,
    delay_hours = 24, trigger_event, notes,
  } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (!type || !VALID_TYPES.includes(type))
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  if (!VALID_CHANNELS.includes(channel))
    return res.status(400).json({ error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` });
  if (!VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      user_id: req.user.id,
      name: name.trim(),
      type,
      channel,
      status,
      target_segment,
      message_template: message_template || null,
      delay_hours: Math.max(1, Number(delay_hours) || 24),
      trigger_event: trigger_event || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/campaigns/:id
router.patch('/:id', authenticate, async (req, res) => {
  const allowed = [
    'name', 'type', 'channel', 'status', 'target_segment',
    'message_template', 'delay_hours', 'trigger_event', 'notes',
  ];
  const payload = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  }

  if (payload.type && !VALID_TYPES.includes(payload.type))
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  if (payload.channel && !VALID_CHANNELS.includes(payload.channel))
    return res.status(400).json({ error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` });
  if (payload.status && !VALID_STATUSES.includes(payload.status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  if (Object.keys(payload).length === 0)
    return res.status(400).json({ error: 'No valid fields to update' });

  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('campaigns')
    .update(payload)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Campaign not found' });
  res.json(data);
});

// DELETE /api/campaigns/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/campaigns/:id/activate
router.post('/:id/activate', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('campaigns')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Campaign not found' });
  res.json(data);
});

// POST /api/campaigns/:id/pause
router.post('/:id/pause', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('campaigns')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Campaign not found' });
  res.json(data);
});

// GET /api/campaigns/:id/runs — recent execution history
router.get('/:id/runs', authenticate, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  // Verify campaign ownership
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { data, error } = await supabase
    .from('campaign_runs')
    .select('*')
    .eq('campaign_id', req.params.id)
    .order('triggered_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/campaigns/:id/trigger — manually fire campaign for one recipient
router.post('/:id/trigger', authenticate, async (req, res) => {
  const { entity_id, entity_type, recipient_phone, recipient_email, recipient_name } = req.body;

  const { data: campaign, error: fetchError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (fetchError || !campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'archived') return res.status(400).json({ error: 'Archived campaigns cannot be triggered' });

  try {
    const result = await triggerCampaignManually({
      campaign,
      entityId:       entity_id    || null,
      entityType:     entity_type  || null,
      recipientPhone: recipient_phone || null,
      recipientEmail: recipient_email || null,
      recipientName:  recipient_name  || null,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
