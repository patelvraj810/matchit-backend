/**
 * Invoice Routes
 * GET  /api/invoices        - List all invoices for user
 * POST /api/invoices        - Create a new invoice
 * GET /api/invoices/:id     - Get single invoice
 * POST /api/invoices/:id/send - Send invoice to customer
 */

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');
const { generateInvoice, sendInvoice, checkUnpaidInvoices } = require('../services/invoices');

/**
 * GET /api/invoices
 * List all invoices for the authenticated user
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, from_date, to_date } = req.query;
    
    let query = supabase
      .from('invoices')
      .select(`
        *,
        leads (
          id,
          contact_name,
          contact_phone,
          contact_email
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    if (from_date) {
      query = query.gte('created_at', from_date);
    }
    if (to_date) {
      query = query.lte('created_at', to_date);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Invoices] List error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.json(data || []);
  } catch (error) {
    console.error('[Invoices] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/invoices
 * Create a new invoice
 * Body: { lead_id, job_description, line_items, subtotal, tax_rate }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      lead_id, 
      job_description, 
      line_items, 
      subtotal, 
      tax_rate,
      due_date 
    } = req.body;

    if (!job_description || subtotal === undefined) {
      return res.status(400).json({ error: 'job_description and subtotal are required' });
    }

    // Get lead and user data for invoice generation
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .eq('user_id', userId)
      .single();

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const businessData = {
      user_id: userId,
      id: userId,
      name: user?.business_name || user?.name || 'Business',
      tax_rate: tax_rate || user?.tax_rate || 0.13,
      phone: user?.phone
    };

    const customerData = {
      name: lead.contact_name,
      phone: lead.contact_phone,
      email: lead.contact_email
    };

    const jobData = {
      id: lead_id,
      description: job_description,
      amount: subtotal,
      line_items: line_items || [
        {
          description: job_description,
          quantity: 1,
          unit_price: subtotal,
          total: subtotal
        }
      ]
    };

    const invoice = generateInvoice(jobData, businessData, customerData);

    // Override due_date if provided
    if (due_date) {
      invoice.due_date = due_date;
    }

    const { data: created, error: createError } = await supabase
      .from('invoices')
      .insert([invoice])
      .select()
      .single();

    if (createError) {
      console.error('[Invoices] Create error:', createError);
      return res.status(500).json({ error: createError.message });
    }

    res.status(201).json(created);
  } catch (error) {
    console.error('[Invoices] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/invoices/:id
 * Get a single invoice by ID
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const { data, error } = await supabase
      .from('invoices')
      .select(`
        *,
        leads (
          id,
          contact_name,
          contact_phone,
          contact_email
        ),
        users (
          id,
          name,
          business_name,
          email,
          phone
        )
      `)
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(data);
  } catch (error) {
    console.error('[Invoices] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/invoices/:id/send
 * Send an invoice to the customer via WhatsApp
 * Body: { phone (optional - uses lead phone if not provided), email (optional) }
 */
router.post('/:id/send', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { phone, email } = req.body;

    // Verify invoice belongs to user
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, user_id, lead_id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (invoiceError || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Get lead phone/email if not provided
    const { data: lead } = await supabase
      .from('leads')
      .select('phone, email')
      .eq('id', invoice.lead_id)
      .single();

    const result = await sendInvoice(
      id,
      phone || lead?.phone,
      email || lead?.email
    );

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to send invoice' });
    }

    res.json({
      success: true,
      invoice: result.invoice,
      paymentLink: result.paymentLink,
      whatsappSent: result.whatsappSent
    });
  } catch (error) {
    console.error('[Invoices] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
