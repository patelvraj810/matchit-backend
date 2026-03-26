// Estimates — pre-job conversion engine
// GET    /api/estimates              — list all estimates
// POST   /api/estimates              — create estimate
// GET    /api/estimates/:id          — get single estimate
// PATCH  /api/estimates/:id          — update estimate (draft/sent only)
// POST   /api/estimates/:id/send     — mark sent (+ optional WhatsApp)
// POST   /api/estimates/:id/approve  — mark approved
// POST   /api/estimates/:id/decline  — mark declined
// POST   /api/estimates/:id/deposit  — mark deposit paid
// POST   /api/estimates/:id/convert  — convert to job

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');
const { createStripeCheckoutSession } = require('../lib/stripe');

// Helper: recalculate totals from line items
function recalcTotals(lineItems, taxRate = 0.13, depositAmount) {
  const subtotal = (lineItems || []).reduce((sum, item) => {
    return sum + (Number(item.quantity || 1) * Number(item.unit_price || 0));
  }, 0);
  const tax_amount = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + tax_amount) * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax_amount,
    total,
    deposit_amount: depositAmount != null ? Number(depositAmount) : null,
  };
}

function isExpiredEstimate(estimate) {
  return !!(estimate?.expires_at && new Date(estimate.expires_at).getTime() < Date.now());
}

async function maybeExpireEstimate(estimate) {
  if (!estimate || estimate.status !== 'sent' || !isExpiredEstimate(estimate)) return estimate;

  const now = new Date().toISOString();
  const { data } = await supabase
    .from('estimates')
    .update({ status: 'expired', updated_at: now })
    .eq('id', estimate.id)
    .select()
    .single();

  return data || { ...estimate, status: 'expired', updated_at: now };
}

async function getBusinessProfile(userId) {
  const { data } = await supabase
    .from('users')
    .select('name, business_name, email, phone')
    .eq('id', userId)
    .single();
  return data || null;
}

function buildPublicEstimate(estimate, business) {
  return {
    id: estimate.id,
    public_token: estimate.public_token,
    customer_name: estimate.customer_name,
    customer_phone: estimate.customer_phone,
    customer_email: estimate.customer_email,
    status: estimate.status,
    line_items: estimate.line_items || [],
    subtotal: estimate.subtotal,
    tax_rate: estimate.tax_rate,
    tax_amount: estimate.tax_amount,
    total: estimate.total,
    deposit_amount: estimate.deposit_amount,
    expires_at: estimate.expires_at,
    sent_at: estimate.sent_at,
    approved_at: estimate.approved_at,
    declined_at: estimate.declined_at,
    deposit_paid_at: estimate.deposit_paid_at,
    converted_job_id: estimate.converted_job_id,
    created_at: estimate.created_at,
    business: {
      name: business?.business_name || business?.name || 'Matchit Pro',
      email: business?.email || null,
      phone: business?.phone || null,
    },
  };
}

async function loadPublicEstimate(token) {
  const { data } = await supabase
    .from('estimates')
    .select('*')
    .eq('public_token', token)
    .single();

  if (!data) return null;
  const estimate = await maybeExpireEstimate(data);
  const business = await getBusinessProfile(estimate.user_id);
  return { estimate, business };
}

// GET /api/estimates/public/:token
router.get('/public/:token', async (req, res) => {
  const loaded = await loadPublicEstimate(req.params.token);
  if (!loaded) return res.status(404).json({ error: 'Estimate not found' });

  const { estimate, business } = loaded;
  if (estimate.status === 'draft') {
    return res.status(403).json({ error: 'This estimate is not ready to be viewed yet' });
  }

  if (!estimate.public_viewed_at) {
    await supabase
      .from('estimates')
      .update({ public_viewed_at: new Date().toISOString() })
      .eq('id', estimate.id);
  }

  res.json(buildPublicEstimate(estimate, business));
});

// POST /api/estimates/public/:token/approve
router.post('/public/:token/approve', async (req, res) => {
  const loaded = await loadPublicEstimate(req.params.token);
  if (!loaded) return res.status(404).json({ error: 'Estimate not found' });
  const { estimate, business } = loaded;

  if (estimate.status === 'expired' || isExpiredEstimate(estimate)) {
    return res.status(400).json({ error: 'This estimate has expired' });
  }
  if (estimate.status !== 'sent') {
    return res.status(400).json({ error: 'Only sent estimates can be approved' });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'approved', approved_at: now, updated_at: now })
    .eq('id', estimate.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(buildPublicEstimate(data, business));
});

// POST /api/estimates/public/:token/decline
router.post('/public/:token/decline', async (req, res) => {
  const loaded = await loadPublicEstimate(req.params.token);
  if (!loaded) return res.status(404).json({ error: 'Estimate not found' });
  const { estimate, business } = loaded;

  if (estimate.status !== 'sent') {
    return res.status(400).json({ error: 'Only sent estimates can be declined' });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'declined', declined_at: now, updated_at: now })
    .eq('id', estimate.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(buildPublicEstimate(data, business));
});

// POST /api/estimates/public/:token/deposit-checkout
router.post('/public/:token/deposit-checkout', async (req, res) => {
  const loaded = await loadPublicEstimate(req.params.token);
  if (!loaded) return res.status(404).json({ error: 'Estimate not found' });
  const { estimate } = loaded;

  if (estimate.status !== 'approved') {
    return res.status(400).json({ error: 'Deposit payment is only available after approval' });
  }
  if (!estimate.deposit_amount || Number(estimate.deposit_amount) <= 0) {
    return res.status(400).json({ error: 'This estimate does not require a deposit' });
  }

  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const session = await createStripeCheckoutSession({
    amount: Number(estimate.deposit_amount),
    customerEmail: estimate.customer_email || undefined,
    description: `Deposit for estimate ${estimate.customer_name}`,
    metadata: {
      kind: 'estimate_deposit',
      estimate_id: estimate.id,
    },
    successUrl: `${appUrl}/estimate/${estimate.public_token}?payment=success`,
    cancelUrl: `${appUrl}/estimate/${estimate.public_token}?payment=cancelled`,
  });

  res.json({ url: session.url });
});

// GET /api/estimates
router.get('/', authenticate, async (req, res) => {
  const { status } = req.query;
  let query = supabase
    .from('estimates')
    .select('*, leads(contact_name, contact_email, contact_phone)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/estimates
router.post('/', authenticate, async (req, res) => {
  const {
    lead_id, conversation_id,
    customer_name, customer_phone, customer_email,
    line_items = [], tax_rate = 0.13, deposit_amount,
    expires_at, notes,
  } = req.body;

  if (!customer_name) return res.status(400).json({ error: 'customer_name is required' });

  const totals = recalcTotals(line_items, tax_rate, deposit_amount);

  if (deposit_amount != null) {
    const dep = Number(deposit_amount);
    if (dep < 0) return res.status(400).json({ error: 'deposit_amount cannot be negative' });
    if (dep > totals.total) return res.status(400).json({ error: `deposit_amount ($${dep.toFixed(2)}) cannot exceed total ($${totals.total.toFixed(2)})` });
  }

  const { data, error } = await supabase
    .from('estimates')
    .insert({
      user_id: req.user.id,
      lead_id: lead_id || null,
      conversation_id: conversation_id || null,
      customer_name,
      customer_phone: customer_phone || null,
      customer_email: customer_email || null,
      status: 'draft',
      line_items,
      tax_rate,
      expires_at: expires_at || null,
      notes: notes || null,
      ...totals,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/estimates/:id
router.get('/:id', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('estimates')
    .select('*, leads(contact_name, contact_email, contact_phone, source)')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Estimate not found' });
  res.json(data);
});

// PATCH /api/estimates/:id
router.patch('/:id', authenticate, async (req, res) => {
  // Load full existing row so we can use its fields in recalc fallback
  const { data: existing } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!existing) return res.status(404).json({ error: 'Estimate not found' });
  if (!['draft', 'sent'].includes(existing.status)) {
    return res.status(400).json({ error: `Cannot edit estimate in status: ${existing.status}` });
  }

  const allowed = [
    'customer_name', 'customer_phone', 'customer_email',
    'line_items', 'tax_rate', 'deposit_amount',
    'expires_at', 'notes',
  ];
  const payload = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  }

  // Always recalculate totals — line items, tax rate, or deposit may have changed
  const lineItems = payload.line_items ?? existing.line_items ?? [];
  const taxRate = payload.tax_rate ?? existing.tax_rate ?? 0.13;
  const depositArg = 'deposit_amount' in payload ? payload.deposit_amount : existing.deposit_amount;
  const totals = recalcTotals(lineItems, taxRate, depositArg);

  // Validate deposit against recalculated total
  if (depositArg != null) {
    const dep = Number(depositArg);
    if (dep < 0) return res.status(400).json({ error: 'deposit_amount cannot be negative' });
    if (dep > totals.total) return res.status(400).json({ error: `deposit_amount ($${dep.toFixed(2)}) cannot exceed total ($${totals.total.toFixed(2)})` });
  }

  Object.assign(payload, totals);

  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('estimates')
    .update(payload)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/estimates/:id/send
router.post('/:id/send', authenticate, async (req, res) => {
  const { data: existing } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!existing) return res.status(404).json({ error: 'Estimate not found' });
  if (!['draft', 'sent'].includes(existing.status)) {
    return res.status(400).json({ error: 'Only draft or sent estimates can be (re)sent' });
  }

  const now = new Date().toISOString();
  const publicToken = existing.public_token || crypto.randomUUID();
  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'sent', sent_at: now, updated_at: now, public_token: publicToken })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Optional WhatsApp send — only if customer phone and WhatsApp configured
  let whatsappSent = false;
  if (existing.customer_phone && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    try {
      const { sendWhatsApp } = require('../lib/whatsapp');
      const appUrl = process.env.APP_URL || 'http://localhost:5173';
      const publicUrl = `${appUrl}/estimate/${publicToken}`;
      const linesSummary = (existing.line_items || [])
        .map(i => `• ${i.name} × ${i.quantity || 1} — $${Number(i.unit_price || 0).toFixed(2)}`)
        .join('\n');
      const msg = `Hi ${existing.customer_name} 👋 Here's your estimate from us:\n\n${linesSummary}\n\nSubtotal: $${existing.subtotal}\nTax (13%): $${existing.tax_amount}\n*Total: $${existing.total}*${existing.deposit_amount ? `\nDeposit required: $${existing.deposit_amount}` : ''}\n\nReview and respond here: ${publicUrl}\n\nThis estimate ${existing.expires_at ? `expires on ${new Date(existing.expires_at).toLocaleDateString('en-CA')}` : 'is valid for 30 days'}.`;
      await sendWhatsApp(existing.customer_phone, msg);
      whatsappSent = true;
    } catch (err) {
      console.warn('[Estimates] WhatsApp send failed:', err.message);
    }
  }

  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  res.json({ ...data, whatsappSent, publicUrl: `${appUrl}/estimate/${publicToken}` });
});

// POST /api/estimates/:id/approve
router.post('/:id/approve', authenticate, async (req, res) => {
  const { data: existing } = await supabase
    .from('estimates')
    .select('status')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!existing) return res.status(404).json({ error: 'Estimate not found' });
  if (existing.status !== 'sent') {
    return res.status(400).json({ error: 'Only sent estimates can be approved' });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'approved', approved_at: now, updated_at: now })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/estimates/:id/decline
router.post('/:id/decline', authenticate, async (req, res) => {
  const { data: existing } = await supabase
    .from('estimates')
    .select('status')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!existing) return res.status(404).json({ error: 'Estimate not found' });
  if (existing.status !== 'sent') {
    return res.status(400).json({ error: 'Only sent estimates can be declined' });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'declined', declined_at: now, updated_at: now })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/estimates/:id/deposit
router.post('/:id/deposit', authenticate, async (req, res) => {
  const { data: existing } = await supabase
    .from('estimates')
    .select('status')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!existing) return res.status(404).json({ error: 'Estimate not found' });
  if (existing.status !== 'approved') {
    return res.status(400).json({ error: 'Only approved estimates can have deposit marked' });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'deposit_paid', deposit_paid_at: now, updated_at: now })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/estimates/:id/convert  — convert approved estimate to a job
router.post('/:id/convert', authenticate, async (req, res) => {
  const { data: est } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!est) return res.status(404).json({ error: 'Estimate not found' });
  if (!['approved', 'deposit_paid'].includes(est.status)) {
    return res.status(400).json({ error: 'Only approved estimates can be converted to jobs' });
  }

  const { scheduled_date, scheduled_time, address, technician_id } = req.body;

  // Resolve optional technician assignment (validate ownership + active status)
  let assignment = { technician_id: null, technician_name: null };
  if (technician_id) {
    const { data: tech } = await supabase
      .from('team_members')
      .select('id, name, is_active')
      .eq('id', technician_id)
      .eq('user_id', req.user.id)
      .single();
    if (!tech) return res.status(400).json({ error: 'Technician not found in your workspace' });
    if (!tech.is_active) return res.status(400).json({ error: `${tech.name} is inactive and cannot be assigned` });
    assignment = { technician_id: tech.id, technician_name: tech.name };
  }

  // Build job description from line items
  const jobDescription = est.line_items.length > 0
    ? est.line_items.map(i => `${i.name}${i.description ? ` (${i.description})` : ''}`).join(', ')
    : 'Service as per estimate';

  // Create the job
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .insert({
      user_id: req.user.id,
      lead_id: est.lead_id || null,
      customer_name: est.customer_name,
      customer_phone: est.customer_phone || null,
      customer_email: est.customer_email || null,
      job_description: jobDescription,
      address: address || null,
      scheduled_date: scheduled_date || null,
      scheduled_time: scheduled_time || null,
      price: est.total,
      notes: est.notes || null,
      status: 'scheduled',
      ...assignment,
    })
    .select()
    .single();

  if (jobError) return res.status(500).json({ error: jobError.message });

  // Update estimate to converted
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('estimates')
    .update({ status: 'converted', converted_job_id: job.id, updated_at: now })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ estimate: data, job });
});

module.exports = router;
