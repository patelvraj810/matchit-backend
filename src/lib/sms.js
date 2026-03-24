// SMS via Twilio — for customers who prefer plain text
const twilio = require('twilio');

async function sendSMS(to, body) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('[SMS] Twilio not configured — skipping SMS');
    return { skipped: true };
  }
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    from: process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER?.replace('whatsapp:', ''),
    to,
    body
  });
}

module.exports = { sendSMS };
