// Invoice Routes
// GET    /api/invoices              — list invoices, supports ?status=
// POST   /api/invoices              — create invoice (from job_id, lead_id, or manual)
// GET    /api/invoices/:id          — single invoice
// PATCH  /api/invoices/:id          — update status / due_date / notes
// POST   /api/invoices/:id/mark-paid — manual mark as paid (no Stripe)
// POST   /api/invoices/:id/send     — send to customer via WhatsApp + create Stripe link

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');
const { sendInvoice } = require('../services/invoices');

// Join jobs so we can surface job context on list views
const INVOICE_SELECT = '*, jobs(id, customer_name, customer_phone, customer_email, job_description, address)';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcTotals({ lineItems, subtotal, taxRate }) {
  const rate = taxRate !== undefined ? Number(taxRate) : 0.13;
  let sub = subtotal !== undefined ? Number(subtotal) : null;

  if (sub === null || Number.isNaN(sub)) {
    const items = Array.isArray(lineItems) ? lineItems : [];
    sub = items.reduce((sum, item) => {
      const qty = Number(item.quantity || 1);
      const unit = Number(item.unit_price || 0);
      return sum + (Number.isNaN(qty) ? 0 : qty) * (Number.isNaN(unit) ? 0 : unit);
    }, 0);
  }

  const roundedSubtotal = Math.round(sub * 100) / 100;
  const taxAmount = Math.round(roundedSubtotal * rate * 100) / 100;
  const total = Math.round((roundedSubtotal + taxAmount) * 100) / 100;

  return {
    subtotal: roundedSubtotal,
    tax_rate: rate,
    tax_amount: taxAmount,
    total,
  };
}

function futureDue(days = 14) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// ─── GET /api/invoices ────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { status } = req.query;
  let query = supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ─── POST /api/invoices ───────────────────────────────────────────────────────
// Supports three creation paths:
//   1. job_id    — prefills customer info from the jobs row
//   2. lead_id   — prefills customer info from the leads row
//   3. manual    — caller provides customer_name / customer_phone / customer_email
router.post('/', authenticate, async (req, res) => {
  const userId = req.user.id;
  const {
    job_id, lead_id,
    job_description,
    line_items,
    subtotal, tax_rate,
    due_date,
    customer_name, customer_phone, customer_email,
  } = req.body;

  let custName  = customer_name  || null;
  let custPhone = customer_phone || null;
  let custEmail = customer_email || null;
  let resolvedJobId  = job_id  || null;
  let resolvedLeadId = lead_id || null;
  let resolvedDescription = job_description || null;
  let defaultSubtotal = subtotal;
  let defaultLineItems = line_items;

  // Path 1 — job-based: pull customer snapshot from jobs
  if (job_id) {
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('customer_name, customer_phone, customer_email, lead_id, job_description, service_type, price')
      .eq('id', job_id)
      .eq('user_id', userId)
      .single();

    if (jobError || !job) return res.status(404).json({ error: 'Job not found' });
    custName  = custName  || job.customer_name  || null;
    custPhone = custPhone || job.customer_phone || null;
    custEmail = custEmail || job.customer_email || null;
    resolvedLeadId = resolvedLeadId || job.lead_id || null;
    resolvedDescription = resolvedDescription || job.job_description || job.service_type || null;
    if (defaultSubtotal === undefined && job.price != null) defaultSubtotal = Number(job.price);
    if ((!defaultLineItems || defaultLineItems.length === 0) && job.price != null) {
      defaultLineItems = [{
        description: job.service_type || job.job_description || 'Service',
        quantity: 1,
        unit_price: Number(job.price),
        total: Number(job.price),
      }];
    }
  }

  // Path 2 — lead-based: pull from leads
  if (!custName && lead_id) {
    const { data: lead } = await supabase
      .from('leads')
      .select('contact_name, contact_phone, contact_email')
      .eq('id', lead_id)
      .eq('user_id', userId)
      .single();

    if (lead) {
      custName  = lead.contact_name  || null;
      custPhone = lead.contact_phone || null;
      custEmail = lead.contact_email || null;
    }
  }

  if (!custName) {
    return res.status(400).json({ error: 'customer_name is required, or provide job_id / lead_id to look up the customer' });
  }
  if (!resolvedDescription) {
    return res.status(400).json({ error: 'job_description is required' });
  }

  const normalizedItems = Array.isArray(defaultLineItems)
    ? defaultLineItems.map(item => ({
        description: item.description || item.name || resolvedDescription,
        quantity: Number(item.quantity || 1),
        unit_price: Number(item.unit_price || 0),
        total: Math.round(Number(item.quantity || 1) * Number(item.unit_price || 0) * 100) / 100,
      }))
    : [];

  const totals = calcTotals({ lineItems: normalizedItems, subtotal: defaultSubtotal, taxRate: tax_rate });
  if (totals.subtotal <= 0) {
    return res.status(400).json({ error: 'Invoice subtotal must be greater than zero' });
  }

  const { data: created, error: createError } = await supabase
    .from('invoices')
    .insert({
      user_id:        userId,
      job_id:         resolvedJobId,
      lead_id:        resolvedLeadId,
      customer_name:  custName,
      customer_phone: custPhone,
      customer_email: custEmail,
      job_description: resolvedDescription,
      line_items: normalizedItems.length > 0
        ? normalizedItems
        : [{ description: resolvedDescription, quantity: 1, unit_price: totals.subtotal, total: totals.subtotal }],
      subtotal: totals.subtotal,
      tax_rate: totals.tax_rate,
      tax_amount: totals.tax_amount,
      total: totals.total,
      status: 'draft',
      due_date: due_date || futureDue(14),
    })
    .select(INVOICE_SELECT)
    .single();

  if (createError) return res.status(500).json({ error: createError.message });
  res.status(201).json(created);
});

// ─── GET /api/invoices/:id ────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Invoice not found' });
  res.json(data);
});

// ─── PATCH /api/invoices/:id ──────────────────────────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  const { data: existing, error: existingError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (existingError || !existing) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  const payload = {};
  const simpleFields = [
    'status',
    'due_date',
    'stripe_payment_link',
    'job_description',
    'customer_name',
    'customer_phone',
    'customer_email',
  ];

  for (const key of simpleFields) {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  }

  const lineItems = req.body.line_items !== undefined ? req.body.line_items : existing.line_items;
  const subtotal = req.body.subtotal !== undefined ? req.body.subtotal : existing.subtotal;
  const taxRate = req.body.tax_rate !== undefined ? req.body.tax_rate : existing.tax_rate;
  const financialUpdateRequested = (
    req.body.line_items !== undefined ||
    req.body.subtotal !== undefined ||
    req.body.tax_rate !== undefined
  );

  if (financialUpdateRequested) {
    const normalizedItems = Array.isArray(lineItems)
      ? lineItems.map(item => ({
          description: item.description || item.name || existing.job_description,
          quantity: Number(item.quantity || 1),
          unit_price: Number(item.unit_price || 0),
          total: Math.round(Number(item.quantity || 1) * Number(item.unit_price || 0) * 100) / 100,
        }))
      : [];

    const totals = calcTotals({ lineItems: normalizedItems, subtotal, taxRate });
    if (totals.subtotal <= 0) {
      return res.status(400).json({ error: 'Invoice subtotal must be greater than zero' });
    }
    payload.line_items = normalizedItems;
    payload.subtotal = totals.subtotal;
    payload.tax_rate = totals.tax_rate;
    payload.tax_amount = totals.tax_amount;
    payload.total = totals.total;
  }

  if (payload.status === 'paid') {
    payload.paid_at = existing.paid_at || new Date().toISOString();
  } else if (payload.status && payload.status !== 'paid') {
    payload.paid_at = null;
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('invoices')
    .update(payload)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select(INVOICE_SELECT)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Invoice not found' });
  res.json(data);
});

// ─── POST /api/invoices/:id/mark-paid ─────────────────────────────────────────
// Manual payment confirmation — no Stripe involved.
// Idempotent: returns current invoice if already paid.
router.post('/:id/mark-paid', authenticate, async (req, res) => {
  // Check current status first
  const { data: current } = await supabase
    .from('invoices')
    .select('id, status, paid_at')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (!current) return res.status(404).json({ error: 'Invoice not found' });
  if (current.status === 'paid') {
    // Already paid — fetch and return current row
    const { data } = await supabase
      .from('invoices').select(INVOICE_SELECT).eq('id', req.params.id).single();
    return res.json(data);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: now, updated_at: now })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select(INVOICE_SELECT)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ─── POST /api/invoices/:id/send ──────────────────────────────────────────────
// Generates Stripe payment link and sends WhatsApp to customer.
router.post('/:id/send', authenticate, async (req, res) => {
  const { id } = req.params;
  const { phone, email } = req.body;

  // Verify ownership and fetch full row
  const { data: invoice, error: fetchErr } = await supabase
    .from('invoices')
    .select('id, user_id, lead_id, customer_phone, customer_email')
    .eq('id', id)
    .eq('user_id', req.user.id)
    .single();

  if (fetchErr || !invoice) return res.status(404).json({ error: 'Invoice not found' });

  // Resolve contact — prefer explicit body params, then denormalised fields, then lead
  let customerPhone = phone || invoice.customer_phone;
  let customerEmail = email || invoice.customer_email;

  if (invoice.lead_id && (!customerPhone || !customerEmail)) {
    const { data: lead } = await supabase
      .from('leads')
      .select('contact_phone, contact_email')
      .eq('id', invoice.lead_id)
      .single();
    customerPhone = customerPhone || lead?.contact_phone;
    customerEmail = customerEmail || lead?.contact_email;
  }

  const result = await sendInvoice(id, customerPhone, customerEmail);
  if (!result.success) {
    return res.status(500).json({ error: result.error || 'Failed to send invoice' });
  }

  res.json({
    success: true,
    invoice: result.invoice,
    paymentLink: result.paymentLink,
    whatsappSent: result.whatsappSent,
  });
});

module.exports = router;
