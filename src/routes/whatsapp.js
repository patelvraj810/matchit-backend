const express = require('express');
const router = express.Router();
const { sendWhatsApp } = require('../lib/whatsapp');
const { processWhatsApp } = require('../services/pipeline');

// GET /webhook/whatsapp - Meta webhook verification
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified!');
    res.status(200).send(challenge);
  } else {
    console.log('[WhatsApp] Webhook verification failed');
    res.sendStatus(403);
  }
});

// POST /webhook/whatsapp - Receive incoming messages
router.post('/', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    
    if (!value?.messages?.[0]) {
      return res.status(200).send('OK');
    }

    const message = value.messages[0];
    const sender = value.contacts?.[0]?.wa_id;
    const messageText = message.text?.body;
    const messageId = message.id;

    console.log(`[WhatsApp] Incoming from ${sender}: ${messageText}`);

    // Respond immediately to acknowledge receipt
    res.status(200).send('OK');

    // Process in background
    if (messageText && sender) {
      processWhatsApp(sender, messageText, messageId)
        .catch(err => console.error('[WhatsApp] Pipeline error:', err));
    }
  } catch (error) {
    console.error('[WhatsApp] Webhook error:', error);
    res.status(200).send('OK'); // Always return 200 to Meta
  }
});

module.exports = router;
