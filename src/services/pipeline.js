const supabase = require('../lib/db');
const { sendWhatsApp } = require('../lib/whatsapp');
const { generateResponse } = require('../lib/ai');
const { sendEmail } = require('../lib/email');
const { buildPrompt } = require('../lib/systemPrompt');

// Helper: get the first user in the users table (fallback for webhook/public callers)
async function getFirstUserId() {
  const { data } = await supabase
    .from('users')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  return data?.id || null;
}

// Helper: load agent settings from agents table for a given userId
async function loadAgentSettings(userId) {
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('user_id', userId)
    .single();

  return {
    agent,
    agentSettings: {
      name: agent?.name || 'Alex',
      businessName: agent?.business_name || 'Service Business',
      services: agent?.services || [],
      serviceArea: agent?.service_area || '',
      tone: agent?.tone || 'professional'
    }
  };
}

// Helper: load conversation history from messages table
async function loadConversationHistory(conversationId) {
  const { data: priorMsgs } = await supabase
    .from('messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(20);

  return (priorMsgs || []).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));
}

async function processInbound(leadData, userId = null) {
  const { name, email, phone, service, source, message } = leadData;
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] Processing inbound lead:`, { name, phone, service, source });

  // Resolve userId — use passed userId or fall back to first user in DB
  if (!userId) {
    userId = await getFirstUserId();
  }
  if (!userId) {
    throw new Error('No user found in the database — cannot process inbound lead');
  }

  // Load agent settings from agents table
  const { agent, agentSettings } = await loadAgentSettings(userId);

  // 1. Save lead to Supabase
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert({
      user_id: userId,
      contact_name: name,
      contact_email: email || null,
      contact_phone: phone,
      source: source || 'webhook',
      source_detail: service || null,
      message: message || null,
      qualification_status: 'pending',
      last_contact_at: timestamp
    })
    .select()
    .single();

  if (leadError) {
    console.error('Failed to save lead:', leadError);
    throw leadError;
  }

  console.log(`[${timestamp}] Lead saved:`, lead.id);

  // 2. Create conversation record
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      lead_id: lead.id,
      agent_id: agent?.id || null,
      channel: 'web',
      status: 'active'
    })
    .select()
    .single();

  if (convError) {
    console.error('Failed to create conversation:', convError);
    throw convError;
  }

  console.log(`[${timestamp}] Conversation created:`, conversation.id);

  // 3. Save lead's message
  const { error: msgError } = await supabase
    .from('messages')
    .insert({
      user_id: userId,
      conversation_id: conversation.id,
      lead_id: lead.id,
      direction: 'inbound',
      sender_type: 'lead',
      sender_name: name,
      content: message || '',
      channel: 'web',
      status: 'received'
    });

  if (msgError) console.error('Failed to save message:', msgError);

  const leadProfile = {
    name: name,
    source: source || 'webhook',
    channel: 'web',
    messageCount: 1
  };

  // 4. Build prompt with qualifier mode (default for inbound)
  const systemPrompt = buildPrompt(agentSettings, leadProfile, 'qualifier');

  // 5. Load conversation history before generating AI response
  const history = await loadConversationHistory(conversation.id);

  // 6. Generate AI response
  console.log(`[${timestamp}] Generating AI response...`);
  const aiResponse = await generateResponse(systemPrompt, history, message || 'Hi');

  console.log(`[${timestamp}] AI Response:`, aiResponse);

  // 7. Save AI response to messages
  await supabase
    .from('messages')
    .insert({
      user_id: userId,
      conversation_id: conversation.id,
      lead_id: lead.id,
      direction: 'outbound',
      sender_type: 'ai',
      sender_name: agentSettings.name,
      content: aiResponse,
      channel: 'web',
      status: 'sent'
    });

  // 8. Send AI response via email
  if (email) {
    try {
      await sendEmail(
        email,
        `Re: ${service || 'Your inquiry'}`,
        `<p>Hi ${name},</p><p>${aiResponse}</p><p>Best,<br>${agentSettings.name}</p>`
      );
      console.log(`[${timestamp}] Email sent to:`, email);
    } catch (emailErr) {
      console.error('Failed to send email:', emailErr);
    }
  }

  // 9. Update lead with AI response
  await supabase
    .from('leads')
    .update({ qualification_status: 'in_progress' })
    .eq('id', lead.id);

  console.log(`[${timestamp}] Pipeline complete for lead:`, lead.id);

  return { lead, conversation, aiResponse };
}

async function processWhatsApp(senderPhone, messageText, messageId) {
  const timestamp = new Date().toISOString();

  console.log(`[${timestamp}] Processing WhatsApp from ${senderPhone}: ${messageText}`);

  // Determine which user/business should handle this message.
  // The WhatsApp webhook receives messages TO our Twilio/Meta number. For proper
  // multi-tenant routing we would look up which business owns the destination
  // number. For now we check if an existing conversation (and thus lead) already
  // has a user_id, then fall back to the first active user.
  // TODO: implement proper multi-tenant routing by matching the destination phone
  // number against each user's configured WhatsApp number.

  let userId = null;

  // Try to find an existing lead for this phone to inherit their user_id
  const { data: existingLeadForUser } = await supabase
    .from('leads')
    .select('user_id')
    .eq('contact_phone', senderPhone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existingLeadForUser?.user_id) {
    userId = existingLeadForUser.user_id;
  } else {
    userId = await getFirstUserId();
  }

  if (!userId) {
    throw new Error('No user found in the database — cannot process WhatsApp message');
  }

  // Load agent settings from agents table
  const { agent, agentSettings } = await loadAgentSettings(userId);

  // 1. Find or create lead by phone
  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('contact_phone', senderPhone)
    .eq('user_id', userId)
    .single();

  let lead;
  if (existingLead) {
    lead = existingLead;
    console.log(`[${timestamp}] Found existing lead:`, lead.id);
  } else {
    // Create new lead
    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        user_id: userId,
        contact_phone: senderPhone,
        source: 'whatsapp',
        qualification_status: 'pending',
        last_contact_at: timestamp
      })
      .select()
      .single();

    if (error) throw error;
    lead = newLead;
    console.log(`[${timestamp}] Created new lead:`, lead.id);
  }

  // 2. Find or create conversation
  const { data: existingConv } = await supabase
    .from('conversations')
    .select('*')
    .eq('lead_id', lead.id)
    .eq('channel', 'whatsapp')
    .single();

  let conversation;
  if (existingConv) {
    conversation = existingConv;
  } else {
    const { data: newConv, error } = await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        lead_id: lead.id,
        agent_id: agent?.id || null,
        channel: 'whatsapp',
        status: 'active'
      })
      .select()
      .single();
    if (error) throw error;
    conversation = newConv;
  }

  // 3. Save incoming message
  await supabase.from('messages').insert({
    user_id: userId,
    conversation_id: conversation.id,
    lead_id: lead.id,
    direction: 'inbound',
    sender_type: 'lead',
    sender_name: senderPhone,
    content: messageText,
    channel: 'whatsapp',
    status: 'received'
  });

  const leadProfile = {
    name: lead.contact_name || senderPhone,
    source: 'whatsapp',
    channel: 'whatsapp',
    messageCount: 1
  };

  // 4. Build prompt
  const systemPrompt = buildPrompt(agentSettings, leadProfile, 'qualifier');

  // 5. Load conversation history before generating AI response
  const history = await loadConversationHistory(conversation.id);

  // 6. Generate AI response
  const aiResponse = await generateResponse(systemPrompt, history, messageText);

  console.log(`[${timestamp}] AI Response: ${aiResponse}`);

  // 7. Save AI response
  await supabase.from('messages').insert({
    user_id: userId,
    conversation_id: conversation.id,
    lead_id: lead.id,
    direction: 'outbound',
    sender_type: 'ai',
    sender_name: agentSettings.name,
    content: aiResponse,
    channel: 'whatsapp',
    status: 'sent'
  });

  // 8. Send via WhatsApp
  await sendWhatsApp(`+${senderPhone}`, aiResponse);

  // 9. Update lead status
  await supabase
    .from('leads')
    .update({ qualification_status: 'in_progress', last_contact_at: timestamp })
    .eq('id', lead.id);

  console.log(`[${timestamp}] WhatsApp pipeline complete`);
  return { lead, conversation, aiResponse };
}

module.exports = { processInbound, processWhatsApp };
