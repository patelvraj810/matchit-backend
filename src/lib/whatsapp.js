const https = require('https');

/**
 * Send WhatsApp message via Meta Cloud API
 * @param {string} to - Phone number in format +1XXXXXXXXXX
 * @param {string} message - Message text
 * @returns {Promise<object>}
 */
async function sendWhatsApp(to, message) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  
  const payload = JSON.stringify({
    messaging_product: 'whatsapp',
    to: to.replace('+', ''), // Remove + prefix
    type: 'text',
    text: {
      preview_url: false,
      body: message
    }
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v18.0/${phoneId}/messages`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && parsed.messages) {
            console.log(`[WhatsApp] Sent to ${to}:`, parsed.messages[0].id);
            resolve({ success: true, id: parsed.messages[0].id });
          } else {
            console.error(`[WhatsApp] Failed to send to ${to}:`, data);
            resolve({ success: false, error: data });
          }
        } catch (e) {
          resolve({ success: false, error: data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { sendWhatsApp };
