/**
 * Stripe utilities for payment processing
 */

const https = require('https');

// Stripe API base
const STRIPE_API = 'api.stripe.com';

/**
 * Create a Stripe Checkout Session for an invoice
 * @param {Object} options
 * @param {string} options.invoiceId - Invoice UUID
 * @param {number} options.amount - Amount in dollars
 * @param {string} options.customerEmail - Customer email
 * @param {string} options.description - Invoice/job description
 * @returns {Promise<Object>} Stripe checkout session
 */
async function createStripeCheckoutSession({ invoiceId, amount, customerEmail, description }) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  
  if (!stripeKey) {
    console.warn('[Stripe] STRIPE_SECRET_KEY not set, using placeholder link');
    return { url: `https://checkout.stripe.com/pay/invoice_${invoiceId}` };
  }

  // Amount in cents
  const amountCents = Math.round(amount * 100);
  
  const sessionData = new URLSearchParams({
    'mode': 'payment',
    'success_url': `${process.env.APP_URL || 'http://localhost:5173'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    'cancel_url': `${process.env.APP_URL || 'http://localhost:5173'}/payment-cancelled`,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': amountCents.toString(),
    'line_items[0][price_data][product_data][name]': description || 'Invoice Payment',
    'line_items[0][quantity]': '1',
    'metadata[invoice_id]': invoiceId,
    ...(customerEmail && { 'customer_email': customerEmail }),
  }).toString();

  const options = {
    hostname: STRIPE_API,
    path: '/v1/checkout/sessions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.id) {
            console.log(`[Stripe] Checkout session created: ${parsed.id}`);
            resolve(parsed);
          } else {
            console.error(`[Stripe] Failed to create session:`, data);
            resolve({ url: `https://checkout.stripe.com/pay/invoice_${invoiceId}` });
          }
        } catch (e) {
          resolve({ url: `https://checkout.stripe.com/pay/invoice_${invoiceId}` });
        }
      });
    });
    req.on('error', (err) => {
      console.error('[Stripe] Request error:', err);
      resolve({ url: `https://checkout.stripe.com/pay/invoice_${invoiceId}` });
    });
    req.write(sessionData);
    req.end();
  });
}

/**
 * Verify a Stripe webhook signature
 * @param {string} payload - Raw request body
 * @param {string} signature - Stripe-Signature header
 * @param {string} endpointSecret - Webhook endpoint secret
 * @returns {Object|null} Parsed event or null if invalid
 */
function verifyWebhookSignature(payload, signature, endpointSecret) {
  try {
    const crypto = require('crypto');
    const elements = signature.split(',');
    const signatureMap = {};
    
    for (const element of elements) {
      const [key, value] = element.split('=');
      signatureMap[key] = value;
    }
    
    const timestamp = signatureMap['t'];
    const v1Signature = signatureMap['v1'];
    
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac('sha256', endpointSecret)
      .update(signedPayload)
      .digest('hex');
    
    if (crypto.timingSafeEqual(Buffer.from(v1Signature), Buffer.from(expectedSignature))) {
      return JSON.parse(payload);
    }
    
    return null;
  } catch (error) {
    console.error('[Stripe] Signature verification failed:', error);
    return null;
  }
}

/**
 * Create a Stripe Payment Link for an invoice (alternative to Checkout)
 * @param {Object} options
 * @param {number} options.amount - Amount in dollars
 * @param {string} options.description - Description
 * @param {string} options.invoiceId - Invoice UUID for metadata
 * @returns {Promise<string>} Payment link URL
 */
async function createStripePaymentLink({ amount, description, invoiceId }) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  
  if (!stripeKey) {
    return `https://buy.stripe.com/${invoiceId}`;
  }

  const amountCents = Math.round(amount * 100);
  
  // Create a Price first
  const priceData = new URLSearchParams({
    'currency': 'usd',
    'unit_amount': amountCents.toString(),
    'product_data[name]': description || 'Invoice Payment',
    'metadata[invoice_id]': invoiceId,
  });

  const priceOptions = {
    hostname: STRIPE_API,
    path: '/v1/prices',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  };

  const priceResponse = await new Promise((resolve) => {
    const req = https.request(priceOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.write(priceData.toString());
    req.end();
  });

  if (!priceResponse.id) {
    return `https://buy.stripe.com/${invoiceId}`;
  }

  // Create Payment Link
  const linkData = new URLSearchParams({
    'line_items[0][price]': priceResponse.id,
    'line_items[0][quantity]': '1',
    'metadata[invoice_id]': invoiceId,
    'after_completion[redirect][url]': `${process.env.APP_URL || 'http://localhost:5173'}/payment-success?invoice=${invoiceId}`,
  });

  const linkOptions = {
    hostname: STRIPE_API,
    path: '/v1/payment_links',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }
  };

  const linkResponse = await new Promise((resolve) => {
    const req = https.request(linkOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.write(linkData.toString());
    req.end();
  });

  return linkResponse.url || `https://buy.stripe.com/${invoiceId}`;
}

module.exports = {
  createStripeCheckoutSession,
  createStripePaymentLink,
  verifyWebhookSignature
};
