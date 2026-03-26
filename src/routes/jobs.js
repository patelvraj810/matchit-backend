// Jobs Routes
// GET    /api/jobs              — list jobs, supports ?date=, ?status=, ?technician_id=
// POST   /api/jobs              — create job
// GET    /api/jobs/:id          — get job detail (includes assigned technician)
// PATCH  /api/jobs/:id          — update job (assignment validated)
// DELETE /api/jobs/:id          — delete job
// POST   /api/jobs/:id/complete — mark complete, returns invoicePrompt hint

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');

// Technician join fragment — shared across queries
const JOB_SELECT = '*, team_members(id, name, role, title, phone)';

// Resolve a technician_id for this workspace.
// Returns { technician_id, technician_name } ready to write to the jobs row.
// Throws with a user-readable message on invalid/inactive technician.
async function resolveAssignment(userId, techId) {
  if (techId === null || techId === '' || techId === undefined) {
    return { technician_id: null, technician_name: null };
  }
  const { data: tech, error } = await supabase
    .from('team_members')
    .select('id, name, is_active')
    .eq('id', techId)
    .eq('user_id', userId)
    .single();

  if (error || !tech) throw new Error('Technician not found in your workspace');
  if (!tech.is_active) throw new Error(`${tech.name} is currently inactive and cannot be assigned to new jobs`);
  return { technician_id: tech.id, technician_name: tech.name };
}

// Shape a job row for API consumers.
// Merges team_members join into a consistent `technician` field and keeps
// technician_name as a display-ready string for frontend convenience.
function shapeJob(job) {
  if (!job) return job;
  const tech = job.team_members || null;
  return {
    ...job,
    technician_name: tech?.name || job.technician_name || null,
    technician: tech || null,
    // keep team_members key too so Supabase shape is preserved
  };
}

// GET /api/jobs
router.get('/', authenticate, async (req, res) => {
  const { date, status, technician_id } = req.query;

  let query = supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('user_id', req.user.id)
    .order('scheduled_date', { ascending: true, nullsFirst: false })
    .order('scheduled_time', { ascending: true, nullsFirst: false });

  if (date) query = query.eq('scheduled_date', date);
  if (status) query = query.eq('status', status);
  if (technician_id === 'unassigned') {
    query = query.is('technician_id', null);
  } else if (technician_id) {
    query = query.eq('technician_id', technician_id);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(shapeJob));
});

// POST /api/jobs
router.post('/', authenticate, async (req, res) => {
  const {
    lead_id, customer_name, customer_phone, customer_email,
    job_description, service_type, address,
    scheduled_date, scheduled_time, duration_hours,
    status, price, notes, technician_id,
  } = req.body;

  if (!customer_name || !job_description) {
    return res.status(400).json({ error: 'customer_name and job_description are required' });
  }

  let assignment = { technician_id: null, technician_name: null };
  if (technician_id !== undefined) {
    try {
      assignment = await resolveAssignment(req.user.id, technician_id);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
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
      ...assignment,
    })
    .select(JOB_SELECT)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(shapeJob(data));
});

// GET /api/jobs/:id
router.get('/:id', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Job not found' });
  res.json(shapeJob(data));
});

// PATCH /api/jobs/:id
router.patch('/:id', authenticate, async (req, res) => {
  const allowed = [
    'customer_name', 'customer_phone', 'customer_email', 'job_description',
    'service_type', 'address', 'scheduled_date', 'scheduled_time',
    'duration_hours', 'status', 'price', 'notes', 'completion_note', 'lead_id',
  ];

  const payload = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  }

  // Handle technician assignment separately (needs validation)
  if (req.body.technician_id !== undefined) {
    try {
      const assignment = await resolveAssignment(req.user.id, req.body.technician_id);
      Object.assign(payload, assignment);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
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
    .select(JOB_SELECT)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Job not found' });

  // TODO: assignment notification hook
  // If technician changed, trigger notification to tech + owner:
  //   notifyAssignment({ techId: payload.technician_id, jobId: req.params.id, userId: req.user.id })
  // Implement in services/assignmentNotifications.js when WhatsApp/push is ready.

  res.json(shapeJob(data));
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
  const { completion_note } = req.body;

  const updatePayload = { status: 'completed', completed_at: completedAt, updated_at: completedAt };
  if (completion_note !== undefined) updatePayload.completion_note = completion_note;

  const { data, error } = await supabase
    .from('jobs')
    .update(updatePayload)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select(JOB_SELECT)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Job not found' });

  // Return job with prompt hint for invoice creation
  res.json({ job: shapeJob(data), invoicePrompt: true });
});

module.exports = router;
