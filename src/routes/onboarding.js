const express = require('express');
const router = express.Router();
const supabase = require('../lib/db');
const authenticate = require('../middleware/authenticate');

// GET /api/onboarding/status — check if user has completed onboarding
router.get('/status', authenticate, async (req, res) => {
  const userId = req.user.id;

  const { data: user } = await supabase
    .from('users')
    .select('onboarding_completed')
    .eq('id', userId)
    .single();

  res.json({ completed: user?.onboarding_completed || false });
});

// POST /api/onboarding/complete — save all onboarding data and mark complete
router.post('/complete', authenticate, async (req, res) => {
  const userId = req.user.id;

  const {
    // Step 1 — Business basics
    phone,
    city,
    yearsInBusiness,
    // Step 2 — Services
    services,
    startingPrice,
    emergencyAvailable,
    serviceArea,
    // Step 3 — AI agent
    agentName,
    tone,
    openingMessage,
    // Step 4 — Knowledge base (array of { doc_name, doc_type, raw_content })
    knowledge,
    // Step 5 — Hours
    operatingHours,
    // Step 6 — Sources
    selectedSources,
    // Step 7 — Plan + review link
    subscriptionTier,
    googleReviewLink,
  } = req.body;

  // Update users table
  const { error: userErr } = await supabase
    .from('users')
    .update({
      phone: phone || null,
      owner_whatsapp: phone ? phone.replace(/\D/g, '') : null,
      onboarding_completed: true,
      ...(subscriptionTier ? { subscription_tier: subscriptionTier } : {}),
    })
    .eq('id', userId);

  if (userErr) {
    console.error('[Onboarding] users update failed:', userErr.message);
  }

  // Update agents table
  const { error: agentErr } = await supabase
    .from('agents')
    .update({
      name: agentName || 'Alex',
      tone: tone || 'professional',
      services: Array.isArray(services) ? services : [],
      service_area: serviceArea || city || '',
      opening_message: openingMessage || null,
      emergency_available: emergencyAvailable || false,
      operating_hours: operatingHours || {},
      selected_sources: Array.isArray(selectedSources) ? selectedSources : [],
      google_review_link: googleReviewLink || null,
    })
    .eq('user_id', userId);

  if (agentErr) {
    console.error('[Onboarding] agents update failed:', agentErr.message);
  }

  // Save knowledge base documents (replace existing for this user)
  const validDocs = Array.isArray(knowledge)
    ? knowledge.filter(d => d.raw_content && d.raw_content.trim().length > 10)
    : [];

  if (validDocs.length > 0) {
    // Delete old documents
    await supabase.from('business_documents').delete().eq('user_id', userId);

    const rows = validDocs.map(d => ({
      user_id: userId,
      doc_name: d.doc_name || 'Knowledge',
      doc_type: d.doc_type || 'general',
      raw_content: d.raw_content.trim(),
    }));

    const { error: docErr } = await supabase.from('business_documents').insert(rows);
    if (docErr) {
      console.error('[Onboarding] business_documents insert failed:', docErr.message);
    }
  }

  res.json({ success: true });
});

// GET /api/onboarding/knowledge — get saved knowledge documents
router.get('/knowledge', authenticate, async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await supabase
    .from('business_documents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/onboarding/knowledge — upsert a single document
router.post('/knowledge', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { doc_name, doc_type, raw_content } = req.body;

  if (!doc_name || !raw_content) {
    return res.status(400).json({ error: 'doc_name and raw_content are required' });
  }

  // Upsert by doc_type for this user (one doc per type)
  await supabase
    .from('business_documents')
    .delete()
    .eq('user_id', userId)
    .eq('doc_type', doc_type || 'general');

  const { data, error } = await supabase
    .from('business_documents')
    .insert({ user_id: userId, doc_name, doc_type: doc_type || 'general', raw_content })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
