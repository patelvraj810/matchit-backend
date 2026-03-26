/**
 * Campaign Execution Engine
 *
 * Evaluates active campaigns against recent events and fires messages.
 * Runs on a cron schedule (every hour) and can also be triggered manually.
 *
 * Supported trigger types:
 *   job_completed   — review_request, post_job campaigns fire after job completion
 *   estimate_sent   — quote_followup campaigns fire after estimate sent + delay
 *   lead_stale      — stale_lead campaigns fire when a lead has had no activity
 *   manual          — owner-triggered via POST /api/campaigns/:id/trigger
 *
 * Supported channels:
 *   whatsapp   — Meta Cloud API
 *   email      — Resend (requires RESEND_API_KEY env var)
 *   sms        — not yet wired (logs as queued)
 */

const supabase         = require('../lib/db');
const { sendWhatsApp } = require('../lib/whatsapp');
const { sendEmail }    = require('../lib/email');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function daysAgo(d) {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

function renderTemplate(template, vars) {
  return (template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

/**
 * Fetch agent + owner vars for a workspace user.
 * Cache within a single runner invocation to avoid N+1 queries.
 */
let _agentVarsCache = new Map();

async function getAgentVars(userId) {
  if (_agentVarsCache.has(userId)) return _agentVarsCache.get(userId);

  const [{ data: agent }, { data: user }] = await Promise.all([
    supabase.from('agents').select('business_name, name, google_review_link').eq('user_id', userId).maybeSingle(),
    supabase.from('users').select('name').eq('id', userId).maybeSingle(),
  ]);

  const vars = {
    business_name: agent?.business_name || '',
    agent_name:    agent?.name          || '',
    owner_name:    user?.name           || '',
    review_link:   agent?.google_review_link || '',
  };

  _agentVarsCache.set(userId, vars);
  return vars;
}

/**
 * Build a plain-HTML email body wrapping the message text.
 */
function buildEmailHtml(message, businessName) {
  const lines = (message || '').split('\n').map(l =>
    `<p style="margin:0 0 12px;line-height:1.6">${l}</p>`
  ).join('');
  const footer = businessName ? `${businessName} · ` : '';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:0 auto;color:#111;font-size:15px">
    ${lines}
    <hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px">
    <p style="font-size:12px;color:#999;margin:0">${footer}Powered by <a href="https://matchit.ai" style="color:#999">Matchit</a></p>
  </div>`;
}

/**
 * Derive a subject line from campaign type.
 */
function buildEmailSubject(type, customerName) {
  if (type === 'review_request') return `How did we do, ${customerName}?`;
  if (type === 'post_job')       return `Following up on your recent service`;
  if (type === 'quote_followup') return `Quick follow-up on your quote`;
  if (type === 'stale_lead')     return `Still here if you need us`;
  return `A message from our team`;
}

/**
 * Send on the configured channel. Returns { status, errorMessage }.
 *   'sent'    — delivered
 *   'failed'  — delivery attempt failed
 *   'skipped' — no contact info or missing config (not retried)
 *   'queued'  — channel not yet wired
 */
async function sendOnChannel({ channel, type, message, agentVars, phone, email }) {
  if (channel === 'whatsapp') {
    if (!phone) return { status: 'skipped', errorMessage: 'No phone number on file' };
    const result = await sendWhatsApp(phone, message);
    return result.success
      ? { status: 'sent', errorMessage: null }
      : { status: 'failed', errorMessage: result.error || 'WhatsApp send failed' };
  }

  if (channel === 'email') {
    if (!email) return { status: 'skipped', errorMessage: 'No email address on file' };
    if (!process.env.RESEND_API_KEY) return { status: 'skipped', errorMessage: 'RESEND_API_KEY not configured' };
    try {
      const subject = buildEmailSubject(type, '');
      const html    = buildEmailHtml(message, agentVars.business_name);
      await sendEmail(email, subject, html);
      return { status: 'sent', errorMessage: null };
    } catch (err) {
      return { status: 'failed', errorMessage: err.message };
    }
  }

  // sms and any future channel — log as queued until wired
  return { status: 'queued', errorMessage: null };
}

async function logRun({ userId, campaignId, triggerType, entityId, entityType, status, channel, recipientPhone, recipientEmail, messageSent, errorMessage }) {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('campaign_runs')
    .insert({
      user_id:         userId,
      campaign_id:     campaignId,
      trigger_type:    triggerType,
      entity_id:       entityId      || null,
      entity_type:     entityType    || null,
      status,
      channel:         channel       || null,
      recipient_phone: recipientPhone || null,
      recipient_email: recipientEmail || null,
      message_sent:    messageSent    || null,
      error_message:   errorMessage   || null,
      triggered_at:    now,
      sent_at:         status === 'sent' ? now : null,
    })
    .select('id')
    .single();

  // Bump campaign stats
  await supabase
    .from('campaigns')
    .update({ last_run_at: now, run_count: supabase.raw('run_count + 1'), updated_at: now })
    .eq('id', campaignId);

  return data?.id;
}

// ─── Trigger evaluators ───────────────────────────────────────────────────────

/**
 * review_request / post_job: fire for jobs completed within the delay window.
 */
async function runJobCompletedCampaigns(campaigns) {
  const results = { fired: 0, skipped: 0, errors: 0 };

  for (const campaign of campaigns) {
    const windowEnd   = hoursAgo(campaign.delay_hours || 1);
    const windowStart = hoursAgo((campaign.delay_hours || 1) + 24);

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, user_id, customer_name, customer_phone, customer_email, job_description, service_type, scheduled_date, completed_at')
      .eq('user_id', campaign.user_id)
      .eq('status', 'completed')
      .gte('completed_at', windowStart)
      .lte('completed_at', windowEnd);

    if (!jobs || jobs.length === 0) continue;

    const { data: existingRuns } = await supabase
      .from('campaign_runs')
      .select('entity_id')
      .eq('campaign_id', campaign.id)
      .in('status', ['sent', 'queued']);

    const alreadySent = new Set((existingRuns || []).map(r => r.entity_id));
    const agentVars   = await getAgentVars(campaign.user_id);

    for (const job of jobs) {
      if (alreadySent.has(job.id)) { results.skipped++; continue; }

      const customerName = job.customer_name || 'there';
      const serviceName  = job.service_type || job.job_description || 'your recent service';
      const jobDate      = job.completed_at
        ? new Date(job.completed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
        : '';

      const message = renderTemplate(campaign.message_template, {
        customer_name: customerName,
        service_name:  serviceName,
        service:       serviceName,  // backwards compat
        business_name: agentVars.business_name,
        agent_name:    agentVars.agent_name,
        owner_name:    agentVars.owner_name,
        review_link:   agentVars.review_link,
        job_date:      jobDate,
      }) || (campaign.type === 'review_request'
        ? `Hi ${customerName}, thank you for choosing ${agentVars.business_name || 'us'} 🙏 We'd love to hear your feedback — could you leave us a quick Google review? ${agentVars.review_link}\n\nIt only takes a minute and means the world to us!`
        : `Hi ${customerName}, this is ${agentVars.agent_name || agentVars.business_name || 'our team'}. Just checking in — how did everything go? Let us know if there's anything we can help with!`);

      const { status, errorMessage } = await sendOnChannel({
        channel:   campaign.channel,
        type:      campaign.type,
        message,
        agentVars,
        phone: job.customer_phone,
        email: job.customer_email,
      });

      await logRun({
        userId:         campaign.user_id,
        campaignId:     campaign.id,
        triggerType:    'job_completed',
        entityId:       job.id,
        entityType:     'job',
        status,
        channel:        campaign.channel,
        recipientPhone: job.customer_phone,
        recipientEmail: job.customer_email,
        messageSent:    message,
        errorMessage,
      });

      if (status === 'sent')   results.fired++;
      else if (status === 'failed') results.errors++;
      else results.skipped++;
    }
  }

  return results;
}

/**
 * quote_followup: fire for sent estimates with no response beyond delay_hours.
 */
async function runEstimateFollowupCampaigns(campaigns) {
  const results = { fired: 0, skipped: 0, errors: 0 };

  for (const campaign of campaigns) {
    const cutoff = hoursAgo(campaign.delay_hours || 48);

    const { data: estimates } = await supabase
      .from('estimates')
      .select('id, user_id, customer_name, customer_phone, customer_email, total, sent_at')
      .eq('user_id', campaign.user_id)
      .eq('status', 'sent')
      .lte('sent_at', cutoff);

    if (!estimates || estimates.length === 0) continue;

    const { data: existingRuns } = await supabase
      .from('campaign_runs')
      .select('entity_id')
      .eq('campaign_id', campaign.id)
      .in('status', ['sent', 'queued']);

    const alreadySent = new Set((existingRuns || []).map(r => r.entity_id));
    const agentVars   = await getAgentVars(campaign.user_id);

    for (const est of estimates) {
      if (alreadySent.has(est.id)) { results.skipped++; continue; }

      const customerName   = est.customer_name || 'there';
      const estimateTotal  = est.total ? `$${Number(est.total).toFixed(2)}` : 'your quote';

      const message = renderTemplate(campaign.message_template, {
        customer_name:   customerName,
        estimate_total:  estimateTotal,
        quote_total:     estimateTotal,  // backwards compat
        business_name:   agentVars.business_name,
        agent_name:      agentVars.agent_name,
        owner_name:      agentVars.owner_name,
        review_link:     agentVars.review_link,
      }) || `Hi ${customerName}, just following up on the quote we sent you. Do you have any questions? We'd love to get you booked in.\n\n— ${agentVars.agent_name || agentVars.business_name || 'Our team'}`;

      const { status, errorMessage } = await sendOnChannel({
        channel:   campaign.channel,
        type:      campaign.type,
        message,
        agentVars,
        phone: est.customer_phone,
        email: est.customer_email,
      });

      await logRun({
        userId:         campaign.user_id,
        campaignId:     campaign.id,
        triggerType:    'estimate_sent',
        entityId:       est.id,
        entityType:     'estimate',
        status,
        channel:        campaign.channel,
        recipientPhone: est.customer_phone,
        recipientEmail: est.customer_email,
        messageSent:    message,
        errorMessage,
      });

      if (status === 'sent')   results.fired++;
      else if (status === 'failed') results.errors++;
      else results.skipped++;
    }
  }

  return results;
}

/**
 * stale_lead: fire for leads with no activity beyond delay_hours.
 */
async function runStaleLeadCampaigns(campaigns) {
  const results = { fired: 0, skipped: 0, errors: 0 };

  for (const campaign of campaigns) {
    const staleCutoff = hoursAgo(campaign.delay_hours || 72);

    const { data: leads } = await supabase
      .from('leads')
      .select('id, user_id, contact_name, contact_phone, contact_email, message, last_contact_at, created_at')
      .eq('user_id', campaign.user_id)
      .in('qualification_status', ['pending', 'qualified'])
      .lte('last_contact_at', staleCutoff);

    if (!leads || leads.length === 0) continue;

    const { data: existingRuns } = await supabase
      .from('campaign_runs')
      .select('entity_id')
      .eq('campaign_id', campaign.id)
      .gte('triggered_at', daysAgo(7))  // don't re-fire within 7 days
      .in('status', ['sent', 'queued']);

    const alreadySent = new Set((existingRuns || []).map(r => r.entity_id));
    const agentVars   = await getAgentVars(campaign.user_id);

    for (const lead of leads) {
      if (alreadySent.has(lead.id)) { results.skipped++; continue; }

      const customerName = lead.contact_name || 'there';

      const message = renderTemplate(campaign.message_template, {
        customer_name: customerName,
        business_name: agentVars.business_name,
        agent_name:    agentVars.agent_name,
        owner_name:    agentVars.owner_name,
        review_link:   agentVars.review_link,
      }) || `Hey ${customerName}! 👋 Just following up from ${agentVars.business_name || 'our team'}. Are you still looking for help with your request? We have availability this week — just reply and we'll get you sorted!`;

      const { status, errorMessage } = await sendOnChannel({
        channel:   campaign.channel,
        type:      campaign.type,
        message,
        agentVars,
        phone: lead.contact_phone,
        email: lead.contact_email,
      });

      await logRun({
        userId:         campaign.user_id,
        campaignId:     campaign.id,
        triggerType:    'lead_stale',
        entityId:       lead.id,
        entityType:     'lead',
        status,
        channel:        campaign.channel,
        recipientPhone: lead.contact_phone,
        recipientEmail: lead.contact_email,
        messageSent:    message,
        errorMessage,
      });

      if (status === 'sent')   results.fired++;
      else if (status === 'failed') results.errors++;
      else results.skipped++;
    }
  }

  return results;
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function runCampaigns() {
  const totals = { fired: 0, skipped: 0, errors: 0 };

  // Clear per-run agent vars cache
  _agentVarsCache = new Map();

  const { data: allCampaigns, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error('[CampaignRunner] Failed to fetch campaigns:', error.message);
    return totals;
  }

  if (!allCampaigns || allCampaigns.length === 0) return totals;

  const byType = {
    review_request: allCampaigns.filter(c => c.type === 'review_request'),
    post_job:       allCampaigns.filter(c => c.type === 'post_job'),
    quote_followup: allCampaigns.filter(c => c.type === 'quote_followup'),
    stale_lead:     allCampaigns.filter(c => c.type === 'stale_lead'),
  };

  const jobCampaigns = [...byType.review_request, ...byType.post_job];
  if (jobCampaigns.length > 0) {
    const r = await runJobCompletedCampaigns(jobCampaigns);
    totals.fired   += r.fired;
    totals.skipped += r.skipped;
    totals.errors  += r.errors;
  }

  if (byType.quote_followup.length > 0) {
    const r = await runEstimateFollowupCampaigns(byType.quote_followup);
    totals.fired   += r.fired;
    totals.skipped += r.skipped;
    totals.errors  += r.errors;
  }

  if (byType.stale_lead.length > 0) {
    const r = await runStaleLeadCampaigns(byType.stale_lead);
    totals.fired   += r.fired;
    totals.skipped += r.skipped;
    totals.errors  += r.errors;
  }

  console.log(`[CampaignRunner] Run complete — fired:${totals.fired} skipped:${totals.skipped} errors:${totals.errors}`);
  return totals;
}

/**
 * Manually trigger a single campaign for a specific recipient.
 * Used by POST /api/campaigns/:id/trigger
 */
async function triggerCampaignManually({ campaign, entityId, entityType, recipientPhone, recipientEmail, recipientName }) {
  const agentVars    = await getAgentVars(campaign.user_id);
  const customerName = recipientName || 'there';

  const message = renderTemplate(campaign.message_template, {
    customer_name: customerName,
    business_name: agentVars.business_name,
    agent_name:    agentVars.agent_name,
    owner_name:    agentVars.owner_name,
    review_link:   agentVars.review_link,
  }) || `Hi ${customerName}, a message from ${agentVars.business_name || 'our team'}. Looking forward to working with you!`;

  const { status, errorMessage } = await sendOnChannel({
    channel:   campaign.channel,
    type:      campaign.type,
    message,
    agentVars,
    phone: recipientPhone,
    email: recipientEmail,
  });

  const runId = await logRun({
    userId:         campaign.user_id,
    campaignId:     campaign.id,
    triggerType:    'manual',
    entityId:       entityId       || null,
    entityType:     entityType     || null,
    status,
    channel:        campaign.channel,
    recipientPhone: recipientPhone || null,
    recipientEmail: recipientEmail || null,
    messageSent:    message,
    errorMessage,
  });

  return { runId, status, message, errorMessage };
}

function startCampaignRunner() {
  const cron = require('node-cron');
  // Run every hour at :05 past
  cron.schedule('5 * * * *', async () => {
    console.log('[CampaignRunner] Hourly evaluation starting…');
    await runCampaigns();
  });
  console.log('[CampaignRunner] Scheduled — runs every hour');
}

module.exports = { runCampaigns, triggerCampaignManually, startCampaignRunner };
