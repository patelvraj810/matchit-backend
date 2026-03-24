require('dotenv/config');
const express = require('express');
const cors = require('cors');
const webhookRoutes = require('./routes/webhook');
const whatsappRoutes = require('./routes/whatsapp');
const authRoutes = require('./routes/auth');
const invoiceRoutes = require('./routes/invoices');
const agentSettingsRoutes = require('./routes/agentSettings');
const jobsRoutes = require('./routes/jobs');
const analyticsRoutes = require('./routes/analytics');
const channelsRoutes = require('./routes/channels');
const pricebookRoutes = require('./routes/pricebook');
const authenticate = require('./middleware/authenticate');
const supabase = require('./lib/db');
const { restoreReminders } = require('./services/reminders');
const { startMorningBriefing } = require('./services/morningBriefing');
const { startEndOfDaySummary } = require('./services/endOfDaySummary');
const { startInvoiceReminderCheck } = require('./services/invoices');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'https://matchit.ai', 'https://www.matchit.ai', process.env.FRONTEND_URL].filter(Boolean),
  credentials: true
}));
app.use('/webhook', webhookRoutes);
app.use('/webhook', whatsappRoutes);
app.use('/auth', authRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/agent-settings', agentSettingsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/pricebook', pricebookRoutes);

// POST /api/find/request - public service request form (no auth)
app.post('/api/find/request', async (req, res) => {
  const { category, urgency, description, whatsapp } = req.body;

  if (!category || !whatsapp) {
    return res.status(400).json({ error: 'Category and WhatsApp number are required' });
  }

  const contactPhone = whatsapp.replace(/\D/g, '');

  // Save to service_requests table
  const { data, error } = await supabase
    .from('service_requests')
    .insert([{ category, urgency, description, contact_phone: contactPhone, status: 'new' }])
    .select()
    .single();

  if (error) {
    console.error('[Find] service_requests insert failed:', error.message);
    return res.status(500).json({ error: 'Failed to submit request' });
  }

  // Run matching engine — find businesses, create leads, notify them
  let matchCount = 0;
  try {
    const { matchAndNotify } = require('./services/findMatching');
    matchCount = await matchAndNotify({ category, urgency, description, contactPhone });
    console.log(`[Find] Matched ${matchCount} businesses for category: ${category}`);
  } catch (matchErr) {
    console.error('[Find] Matching engine error:', matchErr.message);
  }

  // Confirm to customer via WhatsApp
  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const confirmMsg = matchCount > 0
      ? `Hi! I'm Aria from Matchit 👋 Great news — I found ${matchCount} available pro${matchCount > 1 ? 's' : ''} for your ${category} request. They'll be in touch with you shortly. Expect a message within the next few minutes!`
      : `Hi! I'm Aria from Matchit 👋 Got your ${category} request! I'm reaching out to available pros in your area now. You'll hear back within the hour. Can you share your postal code so I can find the closest match?`;

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:+${contactPhone}`,
      body: confirmMsg,
    });
  } catch (twilioError) {
    console.warn('[Find] Customer WhatsApp confirmation failed:', twilioError.message);
  }

  // Notify platform owner
  try {
    const ownerPhone = (process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || '').replace(/\D/g, '');
    if (ownerPhone && process.env.TWILIO_ACCOUNT_SID) {
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:+${ownerPhone}`,
        body: `🔔 New Matchit Find request:\nCategory: ${category}\nUrgency: ${urgency}\nMatched: ${matchCount} businesses\nCustomer: +${contactPhone}\n${description ? `Note: ${description}` : ''}`,
      });
    }
  } catch (err) {
    console.warn('[Find] Owner notification failed:', err.message);
  }

  res.json({ success: true, requestId: data.id, matchCount });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'matchit-backend', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'matchit-backend' });
});

// GET /api/leads - all leads (protected)
app.get('/api/leads', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/conversations - all conversations with last message (protected)
app.get('/api/conversations', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      *,
      leads (*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) return res.status(500).json({ error: error.message });
  
  // For each conversation, get last message
  const result = await Promise.all((data || []).map(async (conv) => {
    const { data: msgs } = await supabase
      .from('messages')
      .select('content, created_at, direction')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1);
    
    return {
      ...conv,
      lastMessage: msgs?.[0] || null
    };
  }));
  
  res.json(result);
});

// GET /api/stats - dashboard stats (protected)
app.get('/api/stats', authenticate, async (req, res) => {
  const userId = req.user.id;
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.substring(0, 7) + '-01';
  
  // Get leads today
  const { count: leadsToday } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today);
  
  // Get qualified leads
  const { count: qualified } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('qualification_status', 'qualified');
  
  // Get total leads this month
  const { count: thisMonth } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', monthStart);
  
  // Get conversations count
  const { count: conversations } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  
  res.json({
    leadsToday: leadsToday || 0,
    qualified: qualified || 0,
    thisMonth: thisMonth || 0,
    totalConversations: conversations || 0,
    avgResponseTime: '< 60s' // placeholder
  });
});

// GET /api/messages/:conversationId - messages for a conversation (protected)
app.get('/api/messages/:conversationId', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { conversationId } = req.params;
  
  // Verify the conversation belongs to the user
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single();

  if (convError || !conv) {
    return res.status(403).json({ error: 'Access denied to this conversation' });
  }

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.listen(PORT, async () => {
  console.log(`🚀 Matchit backend running on port ${PORT}`);
  
  // ---- Cron Job Startup ----
  // Restore pending reminders from DB (in case server restarted)
  await restoreReminders();
  
  // Start daily cron jobs
  startMorningBriefing();
  startEndOfDaySummary();
  startInvoiceReminderCheck();
  
  console.log('✅ All cron jobs initialized');
});
