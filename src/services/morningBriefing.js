const cron = require('node-cron');
const supabase = require('../lib/db');
const { sendWhatsApp } = require('../lib/whatsapp');

let morningTask = null;

function formatPendingLeads(leads) {
  if (!leads || leads.length === 0) return 'None';
  return leads.map(l => `• ${l.contact_name || 'Unknown'}`).join('\n');
}

async function runMorningBriefing() {
  try {
    const ownerPhone = process.env.OWNER_PHONE;
    if (!ownerPhone) {
      console.warn('[MorningBriefing] OWNER_PHONE not set — skipping briefing');
      return { skipped: true };
    }

    const today = new Date();
    const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = yesterday.toISOString();

    // Get new leads from last 24h
    const { data: newLeads } = await supabase
      .from('leads')
      .select('id')
      .gte('created_at', yesterdayISO);

    // Get in-progress leads
    const { data: inProgressLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('qualification_status', 'in_progress');

    // Get pending leads (up to 5 for listing)
    const { data: pendingLeads } = await supabase
      .from('leads')
      .select('id, contact_name')
      .eq('qualification_status', 'pending')
      .order('last_contact_at', { ascending: false })
      .limit(5);

    // Count active conversations
    const { count: activeConversations } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const newLeadsCount = newLeads?.length || 0;
    const activeConvCount = activeConversations || 0;
    const pendingCount = pendingLeads?.length || 0;

    const message = `Good morning! Here's your Matchit briefing for ${todayStr}:\n\n` +
      `📋 New leads (24h): ${newLeadsCount}\n` +
      `🔄 Active conversations: ${activeConvCount}\n` +
      `⏳ Pending responses: ${pendingCount}\n\n` +
      (pendingCount > 0
        ? `Pending leads:\n${formatPendingLeads(pendingLeads)}\n\n`
        : '') +
      `Have a great day! 💪`;

    await sendWhatsApp(ownerPhone, message);
    console.log('[MorningBriefing] Sent daily briefing to owner');

    return { success: true, newLeads: newLeadsCount, activeConversations: activeConvCount, pending: pendingCount };
  } catch (err) {
    console.error('[MorningBriefing] Error:', err);
    return { success: false, error: err.message };
  }
}

function startMorningBriefing() {
  // Run at 7am daily
  morningTask = cron.schedule('0 7 * * *', async () => {
    await runMorningBriefing();
  }, {
    scheduled: true,
    timezone: 'America/Toronto'
  });

  console.log('[MorningBriefing] Scheduled for 7:00 AM daily (America/Toronto)');
  return morningTask;
}

function stopMorningBriefing() {
  if (morningTask) {
    morningTask.stop();
    morningTask = null;
    console.log('[MorningBriefing] Stopped');
  }
}

module.exports = {
  runMorningBriefing,
  startMorningBriefing,
  stopMorningBriefing
};
