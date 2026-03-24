require('dotenv/config');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, htmlBody) {
  const { data, error } = await resend.emails.send({
    from: 'Matchit <noreply@matchit.ai>',
    to: [to],
    subject: subject,
    html: htmlBody
  });
  
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { sendEmail };
