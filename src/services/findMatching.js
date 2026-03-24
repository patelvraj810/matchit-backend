/**
 * Matchit Find — matching engine
 * Matches a customer service request to registered businesses and notifies them.
 */

const supabase = require('../lib/db');

// Maps customer-facing category to industry + service keywords
const CATEGORY_MAP = {
  hvac:        { industries: ['HVAC', 'Home Services'], keywords: ['hvac', 'heating', 'cooling', 'furnace', 'ac', 'air conditioner', 'heat pump'] },
  plumbing:    { industries: ['Plumbing', 'Home Services'], keywords: ['plumb', 'drain', 'pipe', 'water heater', 'leak', 'faucet', 'toilet'] },
  electrical:  { industries: ['Electrical', 'Home Services'], keywords: ['electric', 'wiring', 'outlet', 'panel', 'circuit', 'breaker'] },
  cleaning:    { industries: ['Cleaning', 'Home Services'], keywords: ['clean', 'maid', 'janitorial', 'housekeep'] },
  landscaping: { industries: ['Landscaping', 'Home Services'], keywords: ['landscap', 'lawn', 'garden', 'snow', 'mow', 'trim'] },
  appliance:   { industries: ['Home Services', 'Appliance Repair'], keywords: ['appliance', 'washer', 'dryer', 'fridge', 'dishwasher', 'stove'] },
  other:       { industries: ['Home Services'], keywords: [] },
};

const MAX_MATCHES = 5;

/**
 * Find agents matching the requested category.
 * Returns array of { userId, agentName, businessName, ownerPhone }.
 */
async function findMatchingAgents(category) {
  const mapping = CATEGORY_MAP[category] || CATEGORY_MAP.other;

  // Get all agents with industry match OR services keyword match
  const { data: agents, error } = await supabase
    .from('agents')
    .select('user_id, name, business_name, services, owner_phone')
    .not('owner_phone', 'is', null);

  if (error || !agents) return [];

  const keywords = mapping.keywords;

  // Also fetch user records to get industry and owner_whatsapp
  const userIds = agents.map(a => a.user_id);
  const { data: users } = await supabase
    .from('users')
    .select('id, industry, owner_whatsapp')
    .in('id', userIds);

  const userMap = {};
  (users || []).forEach(u => { userMap[u.id] = u; });

  const matches = [];
  for (const agent of agents) {
    const user = userMap[agent.user_id] || {};
    const industry = (user.industry || '').toLowerCase();
    const services = Array.isArray(agent.services)
      ? agent.services.join(' ').toLowerCase()
      : (agent.services || '').toLowerCase();

    // Match by industry
    const industryMatch = mapping.industries.some(ind => industry.includes(ind.toLowerCase()));
    // Match by services keywords
    const keywordMatch = keywords.some(kw => services.includes(kw));

    if (industryMatch || keywordMatch) {
      matches.push({
        userId: agent.user_id,
        agentName: agent.name,
        businessName: agent.business_name,
        ownerPhone: user.owner_whatsapp || agent.owner_phone,
      });
    }

    if (matches.length >= MAX_MATCHES) break;
  }

  return matches;
}

/**
 * Create a lead record in the matched business's account.
 */
async function createLeadForBusiness(userId, { category, urgency, description, contactPhone }) {
  const { error } = await supabase
    .from('leads')
    .insert({
      user_id: userId,
      name: `Find Request — ${category}`,
      phone: contactPhone,
      source: 'matchit_find',
      qualification_status: urgency === 'emergency' ? 'hot' : 'new',
      notes: description || '',
    });

  if (error) {
    console.warn(`[Find] Lead insert failed for user ${userId}:`, error.message);
  }
}

/**
 * Notify a matched business owner via WhatsApp.
 */
async function notifyBusiness(ownerPhone, { businessName, category, urgency, contactPhone, description }) {
  if (!ownerPhone) return;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_NUMBER) return;

  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const urgencyLabel = { emergency: '🔴 EMERGENCY', this_week: '🟡 This week', quotes: '🟢 Getting quotes' }[urgency] || urgency;
    const msg = [
      `🔔 New lead from Matchit Find!`,
      ``,
      `Business: ${businessName}`,
      `Service: ${category.toUpperCase()}`,
      `Urgency: ${urgencyLabel}`,
      `Customer WhatsApp: +${contactPhone}`,
      description ? `Details: ${description}` : null,
      ``,
      `This lead has been added to your Matchit dashboard. Reply here to reach the customer directly.`,
    ].filter(l => l !== null).join('\n');

    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:+${ownerPhone.replace(/\D/g, '')}`,
      body: msg,
    });
  } catch (err) {
    console.warn(`[Find] Business notification failed for ${ownerPhone}:`, err.message);
  }
}

/**
 * Main entry point — match and notify.
 * Returns number of businesses matched.
 */
async function matchAndNotify(requestData) {
  const { category, urgency, description, contactPhone } = requestData;

  const matches = await findMatchingAgents(category);

  // Notify all matched businesses and create leads
  await Promise.all(
    matches.map(async (m) => {
      await createLeadForBusiness(m.userId, { category, urgency, description, contactPhone });
      await notifyBusiness(m.ownerPhone, {
        businessName: m.businessName,
        category,
        urgency,
        contactPhone,
        description,
      });
    })
  );

  return matches.length;
}

module.exports = { matchAndNotify, findMatchingAgents };
