const express = require('express');
const router = express.Router();
const { processInbound } = require('../services/pipeline');

// POST /webhook/inbound
// Accepts: { name, email, phone, service, source, message }
// Returns: 200 OK immediately
router.post('/inbound', async (req, res) => {
  const { name, email, phone, service, source, message } = req.body;

  // Validate required fields
  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  // Fire and forget - don't wait for pipeline
  processInbound({ name, email, phone, service, source, message })
    .catch(err => console.error('Pipeline error:', err));

  // Return immediately
  res.status(200).json({ status: 'ok', message: 'Lead received' });
});

module.exports = router;
