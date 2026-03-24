// Jobs Routes
// GET    /api/jobs           — list jobs (protected), supports ?date=YYYY-MM-DD, ?status=
// POST   /api/jobs           — create job (protected)
// GET    /api/jobs/:id       — get job detail (protected)
// PATCH  /api/jobs/:id       — update job status/details (protected)
// DELETE /api/jobs/:id       — delete job (protected)
// POST   /api/jobs/:id/complete — mark job complete, trigger invoice prompt

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');

// GET /api/jobs
router.get('/', authenticate, async (req, res) => {
  const { date, status } = req.query;

  let query = supabase
    .from('jobs')
    .select('*')
    .eq('user_id', req.user.id)
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true });

  if (date) {
    query = query.eq('scheduled_date', date);
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/jobs
router.post('/', authenticate, async (req, res) => {
  const {
    lead_id,
    customer_name,
    customer_phone,
    customer_email,
    job_description,
    service_type,
    address,
    scheduled_date,
    scheduled_time,
    duration_hours,
    status,
    price,
    notes,
    technician_name
  } = req.body;

  if (!customer_name || !job_description) {
    return res.status(400).json({ error: 'customer_name and job_description are required' });
  }

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      user_id: req.user.id,
      lead_id: lead_id || null,
      customer_name,
      customer_phone: customer_phone || null,
      customer_email: customer_email || null,
      job_description,
      service_type: service_type || null,
      address: address || null,
      scheduled_date: scheduled_date || null,
      scheduled_time: scheduled_time || null,
      duration_hours: duration_hours || null,
      status: status || 'scheduled',
      price: price || null,
      notes: notes || null,
      technician_name: technician_name || null
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/jobs/:id
router.get('/:id', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Job not found' });
  res.json(data);
});

// PATCH /api/jobs/:id
router.patch('/:id', authenticate, async (req, res) => {
  const allowed = [
    'customer_name', 'customer_phone', 'customer_email', 'job_description',
    'service_type', 'address', 'scheduled_date', 'scheduled_time',
    'duration_hours', 'status', 'price', 'notes', 'technician_name', 'lead_id'
  ];

  const payload = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('jobs')
    .update(payload)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Job not found' });
  res.json(data);
});

// DELETE /api/jobs/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { error } = await supabase
    .from('jobs')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/jobs/:id/complete
router.post('/:id/complete', authenticate, async (req, res) => {
  const completedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'completed',
      completed_at: completedAt,
      updated_at: completedAt
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Job not found' });

  // Return job with a prompt hint for the frontend to trigger invoice creation
  res.json({ job: data, invoicePrompt: true });
});

module.exports = router;
