// Stripe Webhook Route
// POST /webhook/stripe
//
// Receives Stripe events and reconciles invoice payment status.
// Handles checkout.session.completed and payment_intent.succeeded.
// Idempotent — safe to replay events.
//
// IMPORTANT: This route must be mounted BEFORE express.json() so the raw body
// is available for signature verification. The route applies its own raw body parser.

const express = require('express');
const router = express.Router();
const { verifyWebhookSignature } = require('../lib/stripe');
const { markInvoicePaid } = require('../services/invoices');
const supabase = require('../lib/db');

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature     = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  if (webhookSecret && signature) {
    // Production path — verify Stripe signature
    event = verifyWebhookSignature(req.body.toString(), signature, webhookSecret);
    if (!event) {
      console.error('[Stripe Webhook] Signature verification failed');
      return res.status(400).json({ error: 'Invalid Stripe signature' });
    }
  } else {
    // Dev/test path — no secret configured, parse without verification
    console.warn('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature check');
    try {
      const raw = req.body;
      event = typeof raw === 'string' ? JSON.parse(raw) : (Buffer.isBuffer(raw) ? JSON.parse(raw.toString()) : raw);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }

  const type    = event?.type;
  const eventId = event?.id || 'unknown';
  console.log(`[Stripe Webhook] ${eventId} — ${type}`);

  try {
    if (type === 'checkout.session.completed') {
      const session       = event.data.object;
      const invoiceId     = session.metadata?.invoice_id;
      const estimateId    = session.metadata?.estimate_id;
      const kind          = session.metadata?.kind;
      const paymentIntent = session.payment_intent;

      if (kind === 'estimate_deposit' && estimateId) {
        const now = new Date().toISOString();
        const { data: estimate } = await supabase
          .from('estimates')
          .select('id, status')
          .eq('id', estimateId)
          .single();

        if (estimate) {
          const nextStatus = estimate.status === 'converted' ? 'converted' : 'deposit_paid';
          const { error } = await supabase
            .from('estimates')
            .update({ status: nextStatus, deposit_paid_at: now, updated_at: now })
            .eq('id', estimateId);

          if (error) {
            console.warn(`[Stripe Webhook] Failed to mark estimate ${estimateId} deposit paid: ${error.message}`);
          } else {
            console.log(`[Stripe Webhook] Estimate ${estimateId} marked deposit paid`);
          }
        }
      } else if (invoiceId) {
        const result = await markInvoicePaid(invoiceId, paymentIntent || null);
        if (result.success) {
          console.log(`[Stripe Webhook] Invoice ${invoiceId} marked as paid`);
        } else {
          // Could already be paid — not an error worth retrying
          console.warn(`[Stripe Webhook] markInvoicePaid: ${result.error}`);
        }
      } else if (session.id) {
        // Fallback: look up invoice by stored checkout session ID
        const { data: inv } = await supabase
          .from('invoices')
          .select('id')
          .eq('stripe_checkout_session_id', session.id)
          .single();
        if (inv) {
          const result = await markInvoicePaid(inv.id, paymentIntent || null);
          if (result.success) console.log(`[Stripe Webhook] Invoice ${inv.id} marked paid via session_id lookup`);
        } else {
          console.warn('[Stripe Webhook] checkout.session.completed — no invoice_id in metadata and no session_id match');
        }
      } else {
        console.warn('[Stripe Webhook] checkout.session.completed — no invoice_id in metadata');
      }

    } else if (type === 'payment_intent.succeeded') {
      const pi        = event.data.object;
      const invoiceId = pi.metadata?.invoice_id;
      const estimateId = pi.metadata?.estimate_id;
      const kind = pi.metadata?.kind;

      if (kind === 'estimate_deposit' && estimateId) {
        const now = new Date().toISOString();
        const { error } = await supabase
          .from('estimates')
          .update({ status: 'deposit_paid', deposit_paid_at: now, updated_at: now })
          .eq('id', estimateId)
          .neq('status', 'converted');

        if (!error) {
          console.log(`[Stripe Webhook] Estimate ${estimateId} marked deposit paid via payment_intent`);
        }
      } else if (invoiceId) {
        const result = await markInvoicePaid(invoiceId, pi.id);
        if (result.success) {
          console.log(`[Stripe Webhook] Invoice ${invoiceId} marked as paid via payment_intent`);
        }
      }
    } else if (type === 'payment_intent.payment_failed') {
      const pi        = event.data.object;
      const invoiceId = pi.metadata?.invoice_id;

      if (invoiceId) {
        const { data: inv } = await supabase
          .from('invoices')
          .select('id, status')
          .eq('id', invoiceId)
          .single();

        if (inv && ['sent', 'unpaid'].includes(inv.status)) {
          const now = new Date().toISOString();
          const { error } = await supabase
            .from('invoices')
            .update({ status: 'overdue', updated_at: now })
            .eq('id', invoiceId);

          if (!error) {
            console.log(`[Stripe Webhook] ${eventId} — Invoice ${invoiceId} marked overdue (payment failed)`);
          } else {
            console.warn(`[Stripe Webhook] ${eventId} — Failed to mark invoice ${invoiceId} overdue: ${error.message}`);
          }
        } else {
          console.log(`[Stripe Webhook] ${eventId} — Invoice ${invoiceId} payment failed — status already ${inv?.status || 'unknown'}, no change`);
        }
      } else {
        console.warn(`[Stripe Webhook] ${eventId} — payment_intent.payment_failed — no invoice_id in metadata`);
      }

    } else if (type === 'checkout.session.expired') {
      const session    = event.data.object;
      const invoiceId  = session.metadata?.invoice_id;
      const estimateId = session.metadata?.estimate_id;
      const kind       = session.metadata?.kind;

      if (kind === 'estimate_deposit' && estimateId) {
        // Deposit link expired — clear it so the customer can request a new one
        await supabase
          .from('estimates')
          .update({ stripe_deposit_link: null, updated_at: new Date().toISOString() })
          .eq('id', estimateId)
          .in('status', ['sent', 'approved']);
        console.log(`[Stripe Webhook] ${eventId} — Estimate ${estimateId} deposit link cleared (session expired)`);
      } else if (invoiceId) {
        // Payment link expired — clear stored link so owner can resend to regenerate
        const { error } = await supabase
          .from('invoices')
          .update({ stripe_payment_link: null, updated_at: new Date().toISOString() })
          .eq('id', invoiceId)
          .in('status', ['sent', 'unpaid']);

        if (!error) {
          console.log(`[Stripe Webhook] ${eventId} — Invoice ${invoiceId} payment link cleared (session expired) — owner should resend to regenerate`);
        }
      } else {
        console.warn(`[Stripe Webhook] ${eventId} — checkout.session.expired — no invoice_id or estimate_id in metadata`);
      }

    // All other event types are acknowledged but not actioned
    } else {
      console.log(`[Stripe Webhook] ${eventId} — ${type} — no handler, acknowledged`);
    }

  } catch (err) {
    console.error('[Stripe Webhook] Handler error:', err.message);
    // Still return 200 — Stripe will not retry 2xx responses
  }

  // Always acknowledge receipt
  res.json({ received: true });
});

module.exports = router;
