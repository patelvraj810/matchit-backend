require('dotenv/config');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function generateResponse(systemPrompt, history, newMessage) {
  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash-lite',
    systemInstruction: systemPrompt
  });
  
  const chat = model.startChat({
    history: history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.content }]
    }))
  });
  
  const result = await chat.sendMessage(newMessage);
  return result.response.text();
}

module.exports = { generateResponse };
