const cron = require('node-cron');
const supabase = require('../lib/db');
const { sendWhatsApp } = require('../lib/whatsapp');

let eveningTask = null;

async function runEndOfDaySummary() {
  try {
    const ownerPhone = process.env.OWNER_PHONE;
    if (!ownerPhone) {
      console.warn('[EndOfDaySummary] OWNER_PHONE not set — skipping summary');
      return { skipped: true };
    }

    const today = new Date();
    const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const todayISO = today.toISOString().split('T')[0];

    // Get today's new leads
    const { data: newLeads } = await supabase
      .from('leads')
      .select('id')
      .gte('created_at', todayISO);

    // Get leads that moved to 'qualified' today (updated today with status qualified)
    const { data: qualifiedLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('qualification_status', 'qualified')
      .gte('updated_at', todayISO);

    // Count total conversations
    const { count: totalConversations } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true });

    const newLeadsCount = newLeads?.length || 0;
    const qualifiedCount = qualifiedLeads?.length || 0;
    const totalConvCount = totalConversations || 0;

    const message = `Day summary for ${todayStr}:\n\n` +
      `👥 New leads today: ${newLeadsCount}\n` +
      `✅ Qualified today: ${qualifiedCount}\n` +
      `💬 Total conversations: ${totalConvCount}\n\n` +
      `📅 Tomorrow: Keep your AI running 24/7 to capture every lead!`;

    await sendWhatsApp(ownerPhone, message);
    console.log('[EndOfDaySummary] Sent EOD summary to owner');

    return {
      success: true,
      newLeads: newLeadsCount,
      qualified: qualifiedCount,
      totalConversations: totalConvCount
    };
  } catch (err) {
    console.error('[EndOfDaySummary] Error:', err);
    return { success: false, error: err.message };
  }
}

function startEndOfDaySummary() {
  // Run at 6pm daily
  eveningTask = cron.schedule('0 18 * * *', async () => {
    await runEndOfDaySummary();
  }, {
    scheduled: true,
    timezone: 'America/Toronto'
  });

  console.log('[EndOfDaySummary] Scheduled for 6:00 PM daily (America/Toronto)');
  return eveningTask;
}

function stopEndOfDaySummary() {
  if (eveningTask) {
    eveningTask.stop();
    eveningTask = null;
    console.log('[EndOfDaySummary] Stopped');
  }
}

module.exports = {
  runEndOfDaySummary,
  startEndOfDaySummary,
  stopEndOfDaySummary
};
