require('dotenv').config();
const OpenAI = require('openai');
const dayjs = require('dayjs');
const axios = require('axios');
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const { loadSettings } = require('./index');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory session store (replace with DB in production)
const sessions = {};

const FAKE_CLASSMATES = ['Ana', 'Tom', 'Sara', 'Mike', 'Lily', 'Ben', 'Emma', 'Noah', 'Olivia', 'Leo'];

const PDF_DIR = path.join(__dirname, 'pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR);

// In-memory store for online students simulation
let onlineStudents = [];
let lastUpdate = Date.now();
const TEACHABLE_API_KEY = process.env.TEACHABLE_API_KEY;

// Email to name mapping from Teachable API
let emailToNameMap = {};

// Helper to fetch and create email-to-name mapping
async function fetchEmailToNameMapping() {
  if (!TEACHABLE_API_KEY) {
    return {};
  }
  
  try {
    const teachableApi = axios.create({
      baseURL: 'https://developers.teachable.com/v1',
      headers: {
        'apiKey': TEACHABLE_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    const response = await teachableApi.get('/users');
    const users = response.data.users || [];
    
    const mapping = {};
    users.forEach(user => {
      if (user.email) {
        const name = user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
        if (name) {
          mapping[user.email] = name;
        }
      }
    });
    
    return mapping;
  } catch (err) {
    console.log('Could not fetch email-to-name mapping:', err.message);
    return {};
  }
}

// Initialize email-to-name mapping
(async () => {
  emailToNameMap = await fetchEmailToNameMapping();
})();

// Helper to get display name from email
function getDisplayName(email) {
  return emailToNameMap[email] || email;
}

// Helper to fetch real students from Teachable API
async function fetchRealStudents() {
  if (!TEACHABLE_API_KEY) {
    return FAKE_CLASSMATES;
  }
  
  try {
    const teachableApi = axios.create({
      baseURL: 'https://developers.teachable.com/v1',
      headers: {
        'apiKey': TEACHABLE_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Fetch students from courses (you may need to adjust this based on your Teachable setup)
    const response = await teachableApi.get('/users');
    const students = response.data.users || [];
    
    // Extract names and filter out empty ones
    return students
      .map(user => user.name || user.first_name + ' ' + user.last_name)
      .filter(name => name && name.trim().length > 0)
      .slice(0, 20); // Limit to 20 students max
  } catch (err) {
    console.log('Using fake classmates due to API error:', err.message);
    return FAKE_CLASSMATES;
  }
}

// Helper to simulate online/offline students
function simulateOnlineStudents(allStudents) {
  const now = Date.now();
  const timeSinceUpdate = now - lastUpdate;
  
  // Update every 30-60 seconds
  if (timeSinceUpdate > 30000 + Math.random() * 30000) {
    const onlineCount = 5 + Math.floor(Math.random() * 6); // 5-10 students
    const shuffled = allStudents.sort(() => 0.5 - Math.random());
    
    onlineStudents = shuffled.slice(0, onlineCount).map(name => ({
      name,
      status: 'online',
      connectedAt: new Date(now - Math.random() * 300000).toISOString() // Random connection time in last 5 minutes
    }));
    
    lastUpdate = now;
  }
  
  return onlineStudents;
}

// GET /api/classmates - fetch real student names with online status
router.get('/classmates', async (req, res) => {
  try {
    const allStudents = await fetchRealStudents();
    const online = simulateOnlineStudents(allStudents);
    
    res.json({ 
      classmates: online,
      lastUpdate: new Date(lastUpdate).toISOString()
    });
  } catch (err) {
    // Fallback to fake students
    const online = simulateOnlineStudents(FAKE_CLASSMATES);
    res.json({ 
      classmates: online,
      lastUpdate: new Date(lastUpdate).toISOString()
    });
  }
});

// POST /api/chat - handle chat messages and generate AI responses
router.post('/chat', async (req, res) => {
  const { email, role, message, participant } = req.body;
  if (!email || !message || !role || !participant) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Session key per student
  const sessionKey = email;
  if (!sessions[sessionKey]) {
    sessions[sessionKey] = { exchanges: 0, log: [] };
  }

  // Enforce message length (max 30 words)
  const wordCount = message.trim().split(/\s+/).length;
  if (wordCount > 30) {
    return res.status(400).json({ error: 'Message exceeds 30 words.' });
  }

  // Log student message with real name
  const timestamp = dayjs().format('YYYY-MM-DD HH:mm');
  const displayName = getDisplayName(email);
  sessions[sessionKey].log.push({ 
    sender: displayName, 
    email: email,
    role, 
    participant, 
    message, 
    timestamp 
  });

  // Prepare messages for OpenAI
  const settings = loadSettings();
  let systemPrompt = '';
  if (participant === 'Instructor Alex') {
    systemPrompt = settings.systemPromptInstructor;
  } else {
    systemPrompt = settings.systemPromptClassmate.replace('a classmate', `${participant}`);
  }
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Student: ${message}` }
  ];

  let aiReply = '...';
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      max_tokens: 60,
      temperature: 0.7,
    });
    aiReply = completion.choices[0].message.content.trim();
  } catch (err) {
    aiReply = 'Sorry, there was an error generating a response. '+ err;
  }

  // Log AI reply
  sessions[sessionKey].log.push({ 
    sender: participant, 
    role: participant === 'Instructor Alex' ? 'instructor' : 'classmate', 
    participant: displayName, 
    message: aiReply, 
    timestamp: dayjs().format('YYYY-MM-DD HH:mm') 
  });
  sessions[sessionKey].exchanges += 1;

  res.json({ reply: aiReply, end: false, displayName: displayName });
});

// POST /api/pdf - append chat to student PDF (now saves as timestamped file in email folder)
router.post('/pdf', async (req, res) => {
  const { email, chatLog } = req.body;
  if (!email || !Array.isArray(chatLog)) {
    return res.status(400).json({ error: 'Missing email or chat log.' });
  }
  // Create a folder for the email (sanitize email for folder name)
  const safeEmail = email.replace(/[^a-zA-Z0-9@.]/g, '_');
  const userDir = path.join(PDF_DIR, safeEmail);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  // Use ISO timestamp for filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const pdfPath = path.join(userDir, `${timestamp}.pdf`);
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  let y = height - 40;
  page.drawText(`Chat Transcript for: ${email}`, { x: 40, y, size: 14, color: rgb(0.04, 0.65, 0.6) });
  y -= 24;
  chatLog.forEach(entry => {
    if (y < 40) {
      page = pdfDoc.addPage();
      y = height - 40;
    }
    page.drawText(`[${entry.timestamp}] ${entry.sender} (${entry.role}): ${entry.message}`, { x: 40, y, size: 10 });
    y -= 14;
  });
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(pdfPath, pdfBytes);
  res.json({ success: true });
});

// GET /api/pdf/list?email=... - list all PDFs for an email
router.get('/pdf/list', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email.' });
  const safeEmail = email.replace(/[^a-zA-Z0-9@.]/g, '_');
  const userDir = path.join(PDF_DIR, safeEmail);
  if (!fs.existsSync(userDir)) return res.json({ pdfs: [] });
  const files = fs.readdirSync(userDir)
    .filter(f => f.endsWith('.pdf'))
    .map(f => ({ file: f, timestamp: f.replace('.pdf', '').replace(/-/g, ':') }));
  res.json({ pdfs: files });
});

// GET /api/pdf?email=...&file=... - download a specific PDF
router.get('/pdf', (req, res) => {
  const { email, file } = req.query;
  if (!email || !file) return res.status(400).json({ error: 'Missing email or file.' });
  const safeEmail = email.replace(/[^a-zA-Z0-9@.]/g, '_');
  const userDir = path.join(PDF_DIR, safeEmail);
  const pdfPath = path.join(userDir, file);
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: 'PDF not found.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${file}`);
  fs.createReadStream(pdfPath).pipe(res);
});

module.exports = router; 