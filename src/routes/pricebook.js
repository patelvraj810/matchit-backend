// Price book management
// GET    /api/pricebook         — list all items
// POST   /api/pricebook         — add item
// PATCH  /api/pricebook/:id     — update item
// DELETE /api/pricebook/:id     — delete item

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/authenticate');
const supabase = require('../lib/db');

// GET /api/pricebook
router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('pricebook_items')
    .select('*')
    .eq('user_id', req.user.id)
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST /api/pricebook
router.post('/', authenticate, async (req, res) => {
  const { name, description, category, unit_price, unit, is_active } = req.body;

  if (!name || unit_price === undefined) {
    return res.status(400).json({ error: 'name and unit_price are required' });
  }

  const { data, error } = await supabase
    .from('pricebook_items')
    .insert({
      user_id: req.user.id,
      name,
      description: description || null,
      category: category || null,
      unit_price,
      unit: unit || 'each',
      is_active: is_active !== undefined ? is_active : true
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/pricebook/:id
router.patch('/:id', authenticate, async (req, res) => {
  const allowed = ['name', 'description', 'category', 'unit_price', 'unit', 'is_active'];

  const payload = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) payload[key] = req.body[key];
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { data, error } = await supabase
    .from('pricebook_items')
    .update(payload)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Item not found' });
  res.json(data);
});

// DELETE /api/pricebook/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { error } = await supabase
    .from('pricebook_items')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
