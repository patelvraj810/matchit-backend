const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { generateToken, hashPassword, comparePassword } = require('../lib/auth');
const authenticate = require('../middleware/authenticate');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// POST /auth/signup
router.post('/signup', async (req, res) => {
  const { name, email, password, businessName, industry } = req.body;

  if (!name || !email || !password || !businessName || !industry) {
    return res.status(400).json({ error: 'All fields are required: name, email, password, businessName, industry' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Check if email already exists in auth.users
  const { data: existingAuth } = await supabase.auth.admin.listUsers();
  if (existingAuth?.users?.find(u => u.email === email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  // Create user in Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, businessName, industry }
  });

  if (authError || !authData.user) {
    return res.status(500).json({ error: 'Failed to create user: ' + (authError?.message || 'Unknown error') });
  }

  const authUser = authData.user;

  // Create user record in users table (name, email only - existing schema)
  const { error: userError } = await supabase
    .from('users')
    .insert({
      id: authUser.id,
      name,
      email,
    });

  if (userError) {
    console.warn('users table insert warning:', userError.message);
  }

  // Create agent profile in agents table
  await supabase
    .from('agents')
    .insert({
      user_id: authUser.id,
      name,
      business_name: businessName,
      services: [],
      service_area: '',
      tone: 'professional',
    });

  const token = generateToken(authUser.id);

  res.status(201).json({
    token,
    user: {
      id: authUser.id,
      name,
      email,
      businessName,
      industry,
    },
  });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Sign in with Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const authUser = authData.user;

  // Get business name from agents table
  const { data: agent } = await supabase
    .from('agents')
    .select('business_name')
    .eq('user_id', authUser.id)
    .single();

  // Also check user_metadata
  const meta = authUser.user_metadata || {};

  const token = generateToken(authUser.id);

  res.json({
    token,
    user: {
      id: authUser.id,
      name: meta.name || authUser.email,
      email: authUser.email,
      businessName: agent?.business_name || meta.businessName || '',
      industry: meta.industry || '',
    },
  });
});

// GET /auth/me
router.get('/me', authenticate, async (req, res) => {
  const userId = req.user.id;

  // Get user from auth
  const { data: authUser, error } = await supabase.auth.admin.getUserById(userId);

  if (error || !authUser?.user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = authUser.user;
  const meta = user.user_metadata || {};

  // Get agent profile
  const { data: agent } = await supabase
    .from('agents')
    .select('business_name')
    .eq('user_id', userId)
    .single();

  res.json({
    id: user.id,
    name: meta.name || user.email,
    email: user.email,
    businessName: agent?.business_name || meta.businessName || '',
    industry: meta.industry || '',
    createdAt: user.created_at,
  });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
