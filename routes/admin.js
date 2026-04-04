const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { adminAuth } = require('../middleware/auth');
const { clientsDB, docsDB, checklistDB, feedbackDB, settingsDB } = require('../database/db');
const { sendMessage, MESSAGES } = require('../services/whatsapp');
const { createPaymentLink } = require('../services/morning');
const { uploadFile, createClientFolder } = require('../services/drive');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const poaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'temp');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, 'poa_' + Date.now() + path.extname(file.originalname));
  }
});
const poaUpload = multer({
  storage: poaStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('רק קבצי PDF מותרים'));
  }
});

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    return res.json({ success: true, token: process.env.ADMIN_PASSWORD, role: 'admin' });
  }
  if (password === process.env.LAWYER_PASSWORD) {
    return res.json({ success: true, token: process.env.LAWYER_PASSWORD, role: 'lawyer' });
  }
  return res.status(401).json({ error: 'סיסמה שגויה' });
});

// All routes below require admin auth
router.use(adminAuth);

// GET /api/admin/clients - get all clients
router.get('/clients', (req, res) => {
  const clients = clientsDB.getAll();
  res.json({ success: true, clients });
});

// GET /api/admin/client/:id - get single client with docs
router.get('/client/:id', (req, res) => {
  const client = clientsDB.findById(req.params.id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  const docs = docsDB.getByClient(client.id);
  const checklist = checklistDB.get(client.id);

  res.json({ success: true, client, docs, checklist });
});

// POST /api/admin/passport/approve - approve passport
router.post('/passport/approve', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  // Create payment link
  const paymentResult = await createPaymentLink(client);
  
  let paymentUrl = paymentResult.success ? paymentResult.paymentUrl : `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}&step=4`;

  clientsDB.update(client.id, {
    passport_status: 'approved',
    current_step: 4,
    payment_ref: paymentResult.docId || null
  });

  // Send WhatsApp
  await sendMessage(client.phone, MESSAGES.PASSPORT_APPROVED(client.first_name, paymentUrl), client.id);

  res.json({ success: true, message: 'דרכון אושר, הלקוח עבר לשלב תשלום' });
});

// POST /api/admin/passport/reject - reject passport
router.post('/passport/reject', async (req, res) => {
  const { client_id, reason } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { passport_status: 'rejected', current_step: 2 });
  clientsDB.block(client.id, reason || 'הדרכון לא אושר', 60);

  // Send WhatsApp
  await sendMessage(client.phone, MESSAGES.PASSPORT_REJECTED(client.first_name), client.id);

  res.json({ success: true, message: 'לקוח נחסם ל-60 יום' });
});

// POST /api/admin/payment/confirm - manually confirm payment
router.post('/payment/confirm', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  const link = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;
  clientsDB.update(client.id, { payment_status: 'paid', current_step: 5 });

  await sendMessage(client.phone, MESSAGES.PAYMENT_RECEIVED(client.first_name, link), client.id);

  res.json({ success: true, message: 'תשלום אושר' });
});

// POST /api/admin/unblock - unblock client manually
router.post('/unblock', (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { blocked: 0, block_until: null, status: 'active' });
  res.json({ success: true, message: 'לקוח שוחרר' });
});

// POST /api/admin/archive - archive a client
router.post('/archive', (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { archived: 1 });
  res.json({ success: true, message: 'הלקוח הועבר לארכיון' });
});

// POST /api/admin/unarchive - restore a client from archive
router.post('/unarchive', (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { archived: 0 });
  res.json({ success: true, message: 'הלקוח שוחזר מהארכיון' });
});

// POST /api/admin/trash - move client to trash
router.post('/trash', (req, res) => {
  const { client_id, reason } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { trashed: 1, trash_reason: reason || 'ידני' });
  res.json({ success: true, message: 'הלקוח הועבר לפח' });
});

// POST /api/admin/untrash - restore client from trash
router.post('/untrash', (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { trashed: 0, trash_reason: null });
  res.json({ success: true, message: 'הלקוח שוחזר מהפח' });
});

// POST /api/admin/reset-client - reset trashed client to start fresh
router.post('/reset-client', (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, {
    current_step: 1,
    status: 'active',
    passport_status: 'pending',
    payment_status: 'pending',
    tracking_number: null,
    shipping_company: null,
    trashed: 0,
    trash_reason: null,
    archived: 0
  });
  res.json({ success: true, message: 'הלקוח אופס ויכול להתחיל מחדש' });
});

// POST /api/admin/verified-reset-client - reset client with secret code verification
const resetAttempts = {}; // { ip: { count, lockedUntil } }
router.post('/verified-reset-client', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const entry = resetAttempts[ip] || { count: 0, lockedUntil: 0 };

  if (entry.lockedUntil > now) {
    const minutesLeft = Math.ceil((entry.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `נחסם. נסה שוב בעוד ${minutesLeft} דקות` });
  }

  const { client_id, code1, code2 } = req.body;
  const masterCode = process.env.MASTER_SECRET_CODE || '';
  const parts = masterCode.split('/');

  if (parts.length < 2 || code1 !== parts[0] || code2 !== parts[1]) {
    entry.count++;
    if (entry.count >= 3) {
      entry.lockedUntil = now + 3 * 60 * 1000;
      entry.count = 0;
      resetAttempts[ip] = entry;
      return res.status(429).json({ error: 'קוד שגוי. נחסם ל-3 דקות' });
    }
    resetAttempts[ip] = entry;
    return res.status(403).json({ error: 'קוד שגוי' });
  }

  delete resetAttempts[ip];

  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, {
    current_step: 1,
    status: 'active',
    passport_status: 'pending',
    payment_status: 'pending',
    tracking_number: null,
    shipping_company: null,
    docs_received: 0,
    account_opened: 0,
    trashed: 0,
    trash_reason: null,
    archived: 0,
    blocked: 0,
    block_until: null,
    block_reason: null
  });

  res.json({ success: true, message: 'הלקוח אופס בהצלחה' });
});

// POST /api/admin/delete - permanently delete client
router.post('/delete', (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.delete(client.id);
  res.json({ success: true, message: 'הלקוח נמחק לצמיתות' });
});

// POST /api/admin/cleanup-stale - auto-trash clients inactive 60+ days in steps 2-3
router.post('/cleanup-stale', (req, res) => {
  const allClients = clientsDB.getAll();
  const now = new Date();
  let count = 0;

  allClients.forEach(c => {
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

  res.json({ success: true, message: `${count} לקוחות הועברו לפח אוטומטית` });
});

// POST /api/admin/upload-poa/:clientId - upload POA document for client
router.post('/upload-poa/:clientId', poaUpload.single('poa_file'), async (req, res) => {
  try {
    const client = clientsDB.findById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });
    if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });

    // Save locally
    const localDir = path.join(__dirname, '..', 'uploads', 'poa');
    fs.mkdirSync(localDir, { recursive: true });
    const savedName = `poa_${client.id}_${Date.now()}.pdf`;
    const savedPath = path.join(localDir, savedName);
    fs.renameSync(req.file.path, savedPath);
    const localUrl = `/uploads/poa/${savedName}`;

    // Save to DB
    docsDB.add({
      client_id: client.id,
      doc_type: 'poa_to_sign',
      original_name: req.file.originalname,
      drive_file_id: null,
      drive_url: localUrl
    });

    // Try Google Drive upload
    let driveUrl = null;
    try {
      const folderResult = await createClientFolder(
        `${client.first_name} ${client.last_name}`, client.phone,
        process.env.DRIVE_FOLDER_POA
      );
      if (folderResult.success) {
        const up = await uploadFile(savedPath, `poa_${client.first_name}_${client.last_name}.pdf`, 'application/pdf', folderResult.folderId);
        if (up.success) {
          driveUrl = up.webViewLink;
          docsDB.add({
            client_id: client.id,
            doc_type: 'poa_to_sign_drive',
            original_name: req.file.originalname,
            drive_file_id: up.fileId,
            drive_url: up.webViewLink
          });
        }
      }
    } catch (e) { console.warn('Drive POA upload skipped:', e.message); }

    res.json({ success: true, message: 'ייפוי כח הועלה בהצלחה', localUrl, driveUrl });
  } catch (err) {
    console.error('POA upload error:', err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/admin/feedback - get all feedback with client info
router.get('/feedback', (req, res) => {
  const allFeedback = feedbackDB.getAll();
  const enriched = allFeedback.map(f => {
    const client = clientsDB.findById(f.client_id);
    return {
      ...f,
      client_name: client ? `${client.first_name} ${client.last_name}` : '-',
      client_phone: client ? client.phone : '-'
    };
  });
  res.json({ success: true, feedback: enriched });
});

// ===== DEMO =====
// GET /api/admin/demo-mode - get demo mode state
router.get('/demo-mode', (req, res) => {
  const enabled = settingsDB.get('demo_mode') ? true : false;
  res.json({ success: true, enabled });
});

// POST /api/admin/demo-mode - toggle demo mode
router.post('/demo-mode', (req, res) => {
  const { enabled } = req.body;
  settingsDB.set('demo_mode', enabled ? 1 : 0);
  res.json({ success: true, enabled: !!enabled, message: enabled ? 'מצב דמו הופעל' : 'מצב דמו כובה' });
});

// POST /api/admin/clear-demos - delete all demo clients
router.post('/clear-demos', (req, res) => {
  const allClients = clientsDB.getAll();
  let count = 0;
  allClients.forEach(c => {
    if (c.is_demo) {
      clientsDB.delete(c.id);
      count++;
    }
  });
  res.json({ success: true, message: `${count} לקוחות דמו נמחקו` });
});

// ===== PASSWORD MANAGEMENT =====
const secretAttempts = {}; // { ip: { count, lockedUntil } }

// POST /api/admin/reset-lockout - clear failed attempt counters
router.post('/reset-lockout', (req, res) => {
  Object.keys(secretAttempts).forEach(k => delete secretAttempts[k]);
  res.json({ success: true });
});

// POST /api/admin/verify-secret - verify master secret code
router.post('/verify-secret', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const entry = secretAttempts[ip] || { count: 0, lockedUntil: 0 };

  if (entry.lockedUntil > now) {
    const minutesLeft = Math.ceil((entry.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `נחסם. נסה שוב בעוד ${minutesLeft} דקות` });
  }

  const { code1, code2, code3 } = req.body;
  const masterCode = process.env.MASTER_SECRET_CODE || '';
  const parts = masterCode.split('/');

  if (parts.length !== 3 || code1 !== parts[0] || code2 !== parts[1] || code3 !== parts[2]) {
    entry.count++;
    if (entry.count >= 3) {
      entry.lockedUntil = now + 5 * 60 * 1000;
      entry.count = 0;
      secretAttempts[ip] = entry;
      return res.status(429).json({ error: 'קוד שגוי. נחסם ל-5 דקות' });
    }
    secretAttempts[ip] = entry;
    return res.status(403).json({ error: 'קוד שגוי', attemptsLeft: 3 - entry.count });
  }

  // Reset attempts on success
  delete secretAttempts[ip];
  res.json({
    success: true,
    admin_password: process.env.ADMIN_PASSWORD,
    lawyer_password: process.env.LAWYER_PASSWORD
  });
});

// POST /api/admin/change-passwords - update passwords
router.post('/change-passwords', (req, res) => {
  const { code1, code2, code3, admin_password, lawyer_password } = req.body;

  // Re-verify secret
  const masterCode = process.env.MASTER_SECRET_CODE || '';
  const parts = masterCode.split('/');
  if (parts.length !== 3 || code1 !== parts[0] || code2 !== parts[1] || code3 !== parts[2]) {
    return res.status(403).json({ error: 'קוד שגוי' });
  }

  // Update in-memory env vars
  if (admin_password) process.env.ADMIN_PASSWORD = admin_password;
  if (lawyer_password) process.env.LAWYER_PASSWORD = lawyer_password;

  // Persist to .env file
  try {
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (admin_password) envContent = envContent.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${admin_password}`);
    if (lawyer_password) envContent = envContent.replace(/^LAWYER_PASSWORD=.*/m, `LAWYER_PASSWORD=${lawyer_password}`);
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (e) {
    console.warn('Could not write .env:', e.message);
  }

  res.json({ success: true, message: 'הסיסמאות עודכנו בהצלחה' });
});

module.exports = router;
