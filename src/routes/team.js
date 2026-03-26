// Team Members + Invitations
// GET    /api/team                        — list all team members
// POST   /api/team                        — add team member
// PATCH  /api/team/:id                    — update team member
// DELETE /api/team/:id                    — remove team member
//
// GET    /api/team/invitations            — list pending invitations
// POST   /api/team/invitations            — create invitation
// POST   /api/team/invitations/:id/resend — bump expiry + resend
// DELETE /api/team/invitations/:id        — revoke invitation

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const authenticate     = require('../middleware/authenticate');
const supabase         = require('../lib/db');
const { generateToken } = require('../lib/auth');

const VALID_ROLES = ['owner', 'admin', 'dispatcher', 'technician'];

// ─── Team members ─────────────────────────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('team_members')
    .select('*')
    .eq('user_id', req.user.id)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post('/', authenticate, async (req, res) => {
  const { name, email, phone, role, title, notes } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  const { data, error } = await supabase
    .from('team_members')
    .insert({
      user_id: req.user.id,
      name: name.trim(),
      email: email || null,
      phone: phone || null,
      role: role || 'technician',
      title: title || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.patch('/:id', authenticate, async (req, res) => {
  // Must come before invitation sub-routes to avoid route shadowing — Express
  // matches in registration order, so /invitations/* are registered first.
  const allowed = ['name', 'email', 'phone', 'role', 'title', 'is_active', 'notes'];
  const payload = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  if (payload.role && !VALID_ROLES.includes(payload.role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  if (payload.name !== undefined) {
    if (!payload.name || !payload.name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
    payload.name = payload.name.trim();
  }

  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('team_members')
    .update(payload)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Team member not found' });
  res.json(data);
});

router.delete('/:id', authenticate, async (req, res) => {
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ─── Invitations ──────────────────────────────────────────────────────────────

// GET /api/team/invitations/accept?token=  — PUBLIC: validate token + return preview
router.get('/invitations/accept', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const { data: invite, error } = await supabase
    .from('invitations')
    .select('id, email, role, status, expires_at, user_id')
    .eq('invite_token', token)
    .maybeSingle();

  if (error || !invite) return res.status(404).json({ error: 'Invite not found' });

  if (invite.status === 'accepted') {
    return res.status(410).json({ error: 'This invite has already been accepted.', status: 'accepted' });
  }
  if (invite.status === 'revoked') {
    return res.status(410).json({ error: 'This invite has been revoked.', status: 'revoked' });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This invite has expired.', status: 'expired' });
  }
  if (invite.status !== 'pending') {
    return res.status(410).json({ error: 'This invite is no longer valid.', status: invite.status });
  }

  // Get workspace details for the preview
  const [{ data: agent }, { data: owner }] = await Promise.all([
    supabase.from('agents').select('business_name').eq('user_id', invite.user_id).maybeSingle(),
    supabase.from('users').select('name').eq('id', invite.user_id).maybeSingle(),
  ]);

  res.json({
    email:          invite.email,
    role:           invite.role,
    workspace_name: agent?.business_name || 'a Matchit workspace',
    inviter_name:   owner?.name || null,
    expires_at:     invite.expires_at,
  });
});

// POST /api/team/invitations/accept  — PUBLIC: create account + mark accepted
router.post('/invitations/accept', async (req, res) => {
  const { token, name, password } = req.body;

  if (!token || !name || !password) {
    return res.status(400).json({ error: 'token, name, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Validate token
  const { data: invite, error: inviteErr } = await supabase
    .from('invitations')
    .select('id, email, role, status, expires_at, user_id')
    .eq('invite_token', token)
    .maybeSingle();

  if (inviteErr || !invite) return res.status(404).json({ error: 'Invite not found' });

  if (invite.status !== 'pending') {
    return res.status(410).json({ error: `Invite is ${invite.status}`, status: invite.status });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Invite has expired', status: 'expired' });
  }

  // Create Supabase Auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email:         invite.email,
    password,
    email_confirm: true,
    user_metadata: { name: name.trim() },
  });

  if (authError) {
    // If already registered, they should log in with existing credentials
    if (authError.message?.includes('already registered') || authError.message?.includes('already been registered')) {
      return res.status(409).json({
        error:        'An account with this email already exists. Please log in instead.',
        code:         'email_exists',
        redirect_to:  '/login',
      });
    }
    return res.status(500).json({ error: 'Failed to create account: ' + authError.message });
  }

  const authUser = authData.user;

  // Insert users record for the new team member
  await supabase.from('users').insert({
    id:    authUser.id,
    name:  name.trim(),
    email: invite.email,
  }).catch(() => {});

  // Insert team_members row in the owner's workspace
  await supabase.from('team_members').insert({
    user_id: invite.user_id,
    name:    name.trim(),
    email:   invite.email,
    role:    invite.role,
  }).catch(() => {});

  // Mark invite accepted
  await supabase.from('invitations').update({
    status:      'accepted',
    accepted_at: new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  }).eq('id', invite.id);

  console.log(`[Invite] Accepted — email: ${invite.email} role: ${invite.role}`);

  const jwtToken = generateToken(authUser.id);

  res.json({
    token: jwtToken,
    user:  { id: authUser.id, name: name.trim(), email: invite.email, role: invite.role },
  });
});

// GET /api/team/invitations
router.get('/invitations', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('user_id', req.user.id)
    .order('invited_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/team/invitations
router.post('/invitations', authenticate, async (req, res) => {
  const { email, role = 'technician' } = req.body;

  if (!email || !email.trim()) return res.status(400).json({ error: 'email is required' });
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  // Check for an existing live (pending) invite for this email in this workspace
  const { data: existing } = await supabase
    .from('invitations')
    .select('id, status')
    .eq('user_id', req.user.id)
    .eq('email', email.toLowerCase().trim())
    .eq('status', 'pending')
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'A pending invitation for this email already exists.' });
  }

  const token      = crypto.randomBytes(32).toString('hex');
  const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invitations')
    .insert({
      user_id:      req.user.id,
      email:        email.toLowerCase().trim(),
      role,
      invite_token: token,
      status:       'pending',
      expires_at:   expiresAt,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // TODO: Send invite email via Resend when email service is connected.
  // The invite link would be: ${process.env.APP_URL}/accept-invite?token=${token}
  // For now, the token is returned in the response for manual distribution.
  console.log(`[Invite] Created invite for ${email} (token: ${token.slice(0, 8)}…)`);

  res.status(201).json({
    ...data,
    // Surface invite URL so the owner can share it manually until email is wired
    invite_url: `${process.env.APP_URL || 'http://localhost:5173'}/accept-invite?token=${token}`,
  });
});

// POST /api/team/invitations/:id/resend
router.post('/invitations/:id/resend', authenticate, async (req, res) => {
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invitations')
    .update({ expires_at: newExpiry, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .eq('status', 'pending')
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Invite not found or already accepted/revoked' });

  console.log(`[Invite] Resent invite ${req.params.id} — new expiry: ${newExpiry}`);
  res.json({
    ...data,
    invite_url: `${process.env.APP_URL || 'http://localhost:5173'}/accept-invite?token=${data.invite_token}`,
  });
});

// DELETE /api/team/invitations/:id
router.delete('/invitations/:id', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('invitations')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Invitation not found' });
  res.json({ success: true });
});

module.exports = router;
