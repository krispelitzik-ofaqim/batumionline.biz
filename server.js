require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Ensure required directories exist before anything else
const requiredDirs = [
  path.join(__dirname, 'data'),
  path.join(__dirname, 'uploads', 'passports'),
  path.join(__dirname, 'uploads', 'temp')
];
requiredDirs.forEach(dir => fs.mkdirSync(dir, { recursive: true }));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use('/api/', limiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files (passports etc) - admin only by URL
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/client', require('./routes/client'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/lawyer', require('./routes/lawyer'));

// Payment webhook from Morning
app.post('/webhook/payment', (req, res) => {
  const { clientsDB } = require('./database/db');
  const { sendMessage, MESSAGES } = require('./services/whatsapp');
  
  try {
    const { doc_id, status } = req.body;
    if (status === 'paid' && doc_id) {
      const client = clientsDB.getAll().find(c => c.payment_ref === doc_id);
      if (client) {
        const APP_URL = process.env.APP_URL || 'http://localhost:3000';
        const link = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;
        clientsDB.update(client.id, { payment_status: 'paid', current_step: 5 });
        sendMessage(client.phone, MESSAGES.PAYMENT_RECEIVED(client.first_name, link), client.id);
      }
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback routes
app.get('/client', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/lawyer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lawyer', 'index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Daily cleanup: auto-trash stale clients (steps 2-3 for 60+ days)
function runDailyCleanup() {
  const { clientsDB } = require('./database/db');
  const now = new Date();
  let count = 0;
  clientsDB.getAll().forEach(c => {
    if (c.trashed || c.archived) return;
    if (c.current_step >= 2 && c.current_step <= 3) {
      const created = new Date(c.created_at);
      const daysSince = Math.floor((now - created) / (1000 * 60 * 60 * 24));
      if (daysSince >= 60) {
        clientsDB.update(c.id, { trashed: 1, trash_reason: 'אוטומטי — לא התקדם 60 יום' });
        count++;
      }
    }
  });
  if (count > 0) console.log(`🗑️ Auto-cleanup: ${count} stale clients moved to trash`);
}

app.listen(PORT, () => {
  console.log(`\n🏦 Batumionline BIZ Server running on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`👤 Client panel: http://localhost:${PORT}/client`);
  console.log(`⚙️  Admin panel:  http://localhost:${PORT}/admin`);
  console.log(`⚖️  Lawyer panel: http://localhost:${PORT}/lawyer\n`);

  // Run cleanup on startup and every 24 hours
  runDailyCleanup();
  setInterval(runDailyCleanup, 24 * 60 * 60 * 1000);
});
