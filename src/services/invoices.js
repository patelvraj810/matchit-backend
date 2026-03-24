/**
 * Invoice Service
 * Handles invoice generation, sending, and payment tracking
 */

const supabase = require('../lib/db');
const { sendWhatsApp } = require('../lib/whatsapp');
const { createStripeCheckoutSession } = require('../lib/stripe');

/**
 * Generate an invoice object from job and customer data
 * @param {Object} jobData - Job/lead data { id, description, amount, ... }
 * @param {Object} businessData - Business data { id, name, tax_rate, address, ... }
 * @param {Object} customerData - Customer data { name, phone, email, address, ... }
 * @returns {Object} Invoice object ready for storage
 */
function generateInvoice(jobData, businessData, customerData) {
  const taxRate = businessData.tax_rate || 0.13;
  const subtotal = jobData.amount || 0;
  const taxAmount = parseFloat((subtotal * taxRate).toFixed(2));
  const total = parseFloat((subtotal + taxAmount).toFixed(2));
  
  const lineItems = jobData.line_items || [
    {
      description: jobData.description || 'Professional Service',
      quantity: 1,
      unit_price: subtotal,
      total: subtotal
    }
  ];

  // Calculate due date (14 days from now)
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);
  
  const invoice = {
    user_id: businessData.user_id || businessData.id,
    lead_id: jobData.id,
    job_description: jobData.description || 'Professional Service',
    line_items: lineItems,
    subtotal: subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total: total,
    status: 'draft', // draft, sent, unpaid, paid, overdue, cancelled
    stripe_payment_link: null,
    sent_at: null,
    paid_at: null,
    due_date: dueDate.toISOString(),
    created_at: new Date().toISOString()
  };

  return invoice;
}

/**
 * Send an invoice to a customer via WhatsApp
 * @param {string} invoiceId - Invoice UUID
 * @param {string} customerPhone - Customer phone number (e.g. +1234567890)
 * @param {string} customerEmail - Customer email address
 * @returns {Promise<Object>} { success, invoice, paymentLink }
 */
async function sendInvoice(invoiceId, customerPhone, customerEmail) {
  try {
    // 1. Fetch invoice from DB
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*, leads(*), users(*)')
      .eq('id', invoiceId)
      .single();

    if (fetchError || !invoice) {
      return { success: false, error: 'Invoice not found' };
    }

    // 2. Generate Stripe checkout session / payment link
    let paymentLink = invoice.stripe_payment_link;
    
    if (!paymentLink) {
      const session = await createStripeCheckoutSession({
        invoiceId: invoice.id,
        amount: invoice.total,
        customerEmail: customerEmail,
        description: invoice.job_description
      });
      
      paymentLink = session.url || `https://checkout.stripe.com/pay/${invoice.id}`;
      
      // Update invoice with payment link
      await supabase
        .from('invoices')
        .update({ stripe_payment_link: paymentLink })
        .eq('id', invoiceId);
    }

    // 3. Send WhatsApp message
    const customerName = invoice.leads?.customer_name || 'there';
    const businessName = invoice.users?.business_name || invoice.users?.name || 'our business';
    
    const whatsAppMessage = `Hi ${customerName}, here is your invoice for ${invoice.job_description} — $${invoice.total.toFixed(2)}. Pay securely here: ${paymentLink}\n\nThank you for choosing ${businessName}! 🙌`;

    let whatsappResult = { success: false };
    if (customerPhone) {
      whatsappResult = await sendWhatsApp(customerPhone, whatsAppMessage);
    }

    // 4. Update invoice status and sent_at
    const { data: updatedInvoice, error: updateError } = await supabase
      .from('invoices')
      .update({ 
        status: 'sent',
        sent_at: new Date().toISOString(),
        stripe_payment_link: paymentLink
      })
      .eq('id', invoiceId)
      .select()
      .single();

    if (updateError) {
      console.error('[Invoice] Failed to update invoice status:', updateError);
    }

    return {
      success: true,
      invoice: updatedInvoice || invoice,
      paymentLink,
      whatsappSent: whatsappResult.success
    };

  } catch (error) {
    console.error('[Invoice] Error sending invoice:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check for unpaid invoices and send follow-ups
 * Should run daily via cron at 10am
 * 
 * Follow-up schedule:
 * - 3 days overdue → polite reminder
 * - 7 days overdue → stronger reminder
 * - 14 days overdue → alert owner to call directly
 * 
 * @returns {Promise<Object>} { checked: number, followUps: number, alerts: number }
 */
async function checkUnpaidInvoices() {
  const results = { checked: 0, followUps: 0, alerts: 0 };
  
  try {
    const now = new Date();
    
    // Get all sent/unpaid invoices
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('*, leads(*), users(*)')
      .in('status', ['sent', 'unpaid']);

    if (error) {
      console.error('[Invoice] Error fetching unpaid invoices:', error);
      return results;
    }

    results.checked = invoices?.length || 0;

    for (const invoice of invoices || []) {
      const sentDate = new Date(invoice.sent_at || invoice.created_at);
      const daysSinceSent = Math.floor((now - sentDate) / (1000 * 60 * 60 * 24));
      
      const customerName = invoice.leads?.customer_name || 'there';
      const customerPhone = invoice.leads?.phone || invoice.users?.phone;
      const ownerPhone = invoice.users?.phone;
      const businessName = invoice.users?.business_name || invoice.users?.name || 'our business';

      // 14+ days → alert owner to call directly
      if (daysSinceSent >= 14 && !invoice.owner_alerted_at) {
        // TODO: Alert the business owner via internal notification
        // For now, log it and optionally send an internal message
        console.log(`[Invoice] ${daysSinceSent} days overdue. Owner alert for invoice ${invoice.id}`);
        
        await supabase
          .from('invoices')
          .update({ 
            status: 'overdue',
            owner_alerted_at: new Date().toISOString()
          })
          .eq('id', invoice.id);
        
        results.alerts++;
        continue;
      }

      // 7-13 days → stronger reminder
      if (daysSinceSent >= 7 && daysSinceSent < 14 && !invoice.second_reminder_at) {
        const message = `Hi ${customerName}, just a reminder that invoice #${invoice.id.slice(0, 8)} for $${invoice.total.toFixed(2)} for ${invoice.job_description} is still unpaid. Please arrange payment at your earliest convenience. Thank you! 🙏`;
        
        if (customerPhone) {
          await sendWhatsApp(customerPhone, message);
        }
        
        await supabase
          .from('invoices')
          .update({ second_reminder_at: new Date().toISOString() })
          .eq('id', invoice.id);
        
        results.followUps++;
        continue;
      }

      // 3-6 days → polite follow-up
      if (daysSinceSent >= 3 && daysSinceSent < 7 && !invoice.first_reminder_at) {
        const message = `Hi ${customerName}, hope you're well! Just a friendly reminder that invoice #${invoice.id.slice(0, 8)} for $${invoice.total.toFixed(2)} for ${invoice.job_description} is due soon. You can pay here: ${invoice.stripe_payment_link || 'https://pay.now/' + invoice.id}\n\nThanks for your business! 😊`;
        
        if (customerPhone) {
          await sendWhatsApp(customerPhone, message);
        }
        
        await supabase
          .from('invoices')
          .update({ first_reminder_at: new Date().toISOString() })
          .eq('id', invoice.id);
        
        results.followUps++;
        continue;
      }
    }

    console.log(`[Invoice] checkUnpaidInvoices complete: checked=${results.checked}, followUps=${results.followUps}, alerts=${results.alerts}`);
    return results;

  } catch (error) {
    console.error('[Invoice] Error in checkUnpaidInvoices:', error);
    return results;
  }
}

/**
 * Mark an invoice as paid
 * Called when Stripe webhook confirms payment
 * @param {string} invoiceId 
 * @param {string} stripePaymentIntentId 
 * @returns {Promise<Object>}
 */
async function markInvoicePaid(invoiceId, stripePaymentIntentId = null) {
  const { data, error } = await supabase
    .from('invoices')
    .update({ 
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: stripePaymentIntentId
    })
    .eq('id', invoiceId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, invoice: data };
}

/**
 * Start the daily invoice reminder check cron job (runs at 10am)
 */
function startInvoiceReminderCheck() {
  // Schedule: 10am daily
  const cron = require('node-cron');
  
  cron.schedule('0 10 * * *', async () => {
    console.log('[Invoice] Running daily unpaid invoice check...');
    await checkUnpaidInvoices();
  });
  
  console.log('[Invoice] Reminder cron scheduled for 10am daily');
}

module.exports = {
  generateInvoice,
  sendInvoice,
  checkUnpaidInvoices,
  markInvoicePaid,
  startInvoiceReminderCheck
};
