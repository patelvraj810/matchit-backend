// GET /api/analytics — comprehensive analytics for the dashboard
// Returns: leads by day (last 30 days), conversion funnel, channel breakdown, response stats

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');

router.get('/', authenticate, async (req, res) => {
  const userId = req.user.id;

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

  try {
    // Leads created in last 30 days (for per-day grouping)
    const { data: recentLeads, error: recentLeadsError } = await supabase
      .from('leads')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgoISO)
      .order('created_at', { ascending: true });

    if (recentLeadsError) throw recentLeadsError;

    // Group leads by date (YYYY-MM-DD)
    const leadsByDay = {};
    for (const lead of recentLeads || []) {
      const day = lead.created_at.split('T')[0];
      leadsByDay[day] = (leadsByDay[day] || 0) + 1;
    }

    // Fill in zero-count days for the last 30 days
    const leadsPerDay = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      leadsPerDay.push({ date: key, count: leadsByDay[key] || 0 });
    }

    // Qualification funnel: count by qualification_status
    const { data: allLeads, error: funnelError } = await supabase
      .from('leads')
      .select('qualification_status')
      .eq('user_id', userId);

    if (funnelError) throw funnelError;

    const funnel = {};
    for (const lead of allLeads || []) {
      const status = lead.qualification_status || 'unknown';
      funnel[status] = (funnel[status] || 0) + 1;
    }

    // Leads by source channel
    const { data: channelLeads, error: channelError } = await supabase
      .from('leads')
      .select('source')
      .eq('user_id', userId);

    if (channelError) throw channelError;

    const byChannel = {};
    for (const lead of channelLeads || []) {
      const src = lead.source || 'unknown';
      byChannel[src] = (byChannel[src] || 0) + 1;
    }

    // Total conversations count
    const { count: totalConversations, error: convError } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (convError) throw convError;

    // Total messages count
    const { count: totalMessages, error: msgError } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (msgError) throw msgError;

    // Total leads count
    const totalLeads = allLeads?.length || 0;

    // Avg leads per week (based on last 30 days)
    const totalRecentLeads = recentLeads?.length || 0;
    const avgLeadsPerWeek = parseFloat(((totalRecentLeads / 30) * 7).toFixed(1));

    res.json({
      leadsPerDay,
      qualificationFunnel: funnel,
      leadsByChannel: byChannel,
      totalLeads,
      totalConversations: totalConversations || 0,
      totalMessages: totalMessages || 0,
      avgLeadsPerWeek
    });
  } catch (err) {
    console.error('[Analytics] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
