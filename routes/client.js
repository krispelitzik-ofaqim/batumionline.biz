const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { clientsDB, docsDB, checklistDB, feedbackDB, settingsDB, backupClient } = require('../database/db');
const { sendMessage, sendAdminNotification, MESSAGES } = require('../services/whatsapp');
const { uploadFile, createClientFolder } = require('../services/drive');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'temp');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('רק קבצי PDF מותרים'));
  }
});

// GET /api/client/status
router.get('/status', (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.json({ exists: false });

  const client = clientsDB.findByPhone(phone);

  if (clientsDB.isBlocked(phone) && client) {
    const blockUntil = new Date(client.block_until);
    const daysLeft = Math.ceil((blockUntil - new Date()) / (1000 * 60 * 60 * 24));
    return res.json({ exists: true, blocked: true, block_reason: client.block_reason, block_until: client.block_until, days_left: daysLeft });
  }

  if (!client) return res.json({ exists: false });

  if (client.trashed) {
    return res.json({ exists: true, trashed: true });
  }

  return res.json({
    exists: true, blocked: false,
    current_step: client.current_step, status: client.status,
    passport_status: client.passport_status, payment_status: client.payment_status,
    tracking_number: client.tracking_number, name: client.first_name
  });
});

// POST /api/client/register
router.post('/register', upload.single('passport_file'), async (req, res) => {
  try {
    const { phone, first_name, last_name, email, id_number, birth_date,
      passport_number, passport_name_en, passport_surname_en, passport_valid, preferred_bank } = req.body;

    if (!phone || !first_name || !last_name)
      return res.status(400).json({ error: 'שדות חובה חסרים' });

    const demoMode = settingsDB.get('demo_mode') ? true : false;

    if (!demoMode && clientsDB.isBlocked(phone))
      return res.status(403).json({ error: 'מספר זה חסום' });

    let client = clientsDB.findByPhone(phone);
    if (client) {
      if (demoMode) {
        // In demo mode, backup then delete existing record and all related data
        backupClient(client);
        const cid = client.id;
        clientsDB.delete(cid);
      } else {
        return res.status(409).json({ error: 'מספר טלפון זה כבר רשום במערכת', current_step: client.current_step });
      }
    }

    const result = clientsDB.create({
      phone, first_name, last_name, email, id_number, birth_date,
      passport_number, passport_name_en, passport_surname_en,
      passport_valid: passport_valid === 'true' ? 1 : 0, preferred_bank,
      is_demo: demoMode ? 1 : 0
    });

    const newClient = clientsDB.findById(result.lastInsertRowid);

    if (req.file) {
      // שמור קובץ דרכון מקומית
      const localDir = path.join(__dirname, '..', 'uploads', 'passports');
      fs.mkdirSync(localDir, { recursive: true });
      const savedName = `passport_${newClient.id}_${Date.now()}.pdf`;
      const savedPath = path.join(localDir, savedName);
      fs.renameSync(req.file.path, savedPath);
      const localUrl = `/uploads/passports/${savedName}`;
      docsDB.add({ client_id: newClient.id, doc_type: 'passport', original_name: req.file.originalname, drive_file_id: null, drive_url: localUrl });

      // נסה גם Google Drive (אופציונלי)
      try {
        const folderResult = await createClientFolder(`${first_name} ${last_name}`, phone, process.env.DRIVE_FOLDER_CLIENTS);
        if (folderResult.success) {
          const up = await uploadFile(savedPath, `passport_${first_name}_${last_name}.pdf`, 'application/pdf', folderResult.folderId);
          if (up.success) docsDB.add({ client_id: newClient.id, doc_type: 'passport_drive', original_name: req.file.originalname, drive_file_id: up.fileId, drive_url: up.webViewLink });
        }
      } catch (e) { console.warn('Drive upload skipped:', e.message); }
    }

    clientsDB.update(newClient.id, { current_step: 2, passport_status: 'reviewing' });
    sendMessage(phone, MESSAGES.STEP1_RECEIVED(first_name), newClient.id).catch(e => console.warn('WA:', e.message));

    // Notify admin about new lead
    const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
    sendAdminNotification(`🔔 ליד חדש!\nשם: ${first_name} ${last_name}\nטלפון: ${phone}\nבנק מועדף: ${preferred_bank || '-'}\nנרשם: ${now}\n\nיש לאשר את הדרכון בפאנל הניהול.`).catch(e => console.warn('Admin WA:', e.message));

    return res.json({ success: true, message: 'הפרטים התקבלו', client_id: newClient.id, current_step: 2 });
  } catch (err) {
    console.error('Register error:', err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/client/temp-pay — temporary: skip payment until Morning is configured
router.post('/temp-pay', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'מספר טלפון חסר' });

    const client = clientsDB.findByPhone(phone);
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

    const APP_URL = process.env.APP_URL || 'http://localhost:3000';
    const link = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;
    clientsDB.update(client.id, { payment_status: 'paid', current_step: 5 });

    sendMessage(client.phone, MESSAGES.PAYMENT_RECEIVED(client.first_name, link), client.id).catch(e => console.warn('WA:', e.message));

    res.json({ success: true, message: 'תשלום אושר (זמני)', current_step: 5 });
  } catch (err) {
    console.error('Temp-pay error:', err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/client/poa - get POA document for client to download
router.get('/poa', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'מספר טלפון חסר' });

  const client = clientsDB.findByPhone(phone);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  const docs = docsDB.getByClient(client.id);
  const poaDrive = docs.find(d => d.doc_type === 'poa_to_sign_drive');
  const poaLocal = docs.find(d => d.doc_type === 'poa_to_sign');

  if (poaDrive && poaDrive.drive_url) {
    return res.json({ success: true, url: poaDrive.drive_url });
  }
  if (poaLocal && poaLocal.drive_url) {
    return res.json({ success: true, url: poaLocal.drive_url });
  }
  res.json({ success: false, error: 'ייפוי כח עדיין לא הועלה' });
});

// POST /api/client/checklist-start
router.post('/checklist-start', (req, res) => {
  const { phone } = req.body;
  const client = clientsDB.findByPhone(phone);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });
  clientsDB.updateStep(client.id, 7);
  res.json({ success: true, current_step: 7 });
});

// POST /api/client/checklist
router.post('/checklist', (req, res) => {
  const { phone, poa_ready, apostille_ready, payslips_ready, passport_ready,
    bank_confirm_ready, bank_statements_ready, address_proof_ready } = req.body;

  const client = clientsDB.findByPhone(phone);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  checklistDB.upsert(client.id, {
    poa_ready: poa_ready ? 1 : 0, apostille_ready: apostille_ready ? 1 : 0,
    payslips_ready: payslips_ready ? 1 : 0, passport_ready: passport_ready ? 1 : 0,
    bank_confirm_ready: bank_confirm_ready ? 1 : 0, bank_statements_ready: bank_statements_ready ? 1 : 0,
    address_proof_ready: address_proof_ready ? 1 : 0
  });

  clientsDB.updateStep(client.id, 8);
  sendMessage(phone, MESSAGES.CHECKLIST_DONE(client.first_name, `${APP_URL}/client?phone=${encodeURIComponent(phone)}`), client.id)
    .catch(e => console.warn('WA:', e.message));

  res.json({ success: true, current_step: 8 });
});

// POST /api/client/upload-docs
const docFields = [
  { name: 'poa_doc', maxCount: 1 }, { name: 'apostille_doc', maxCount: 1 },
  { name: 'payslips_doc', maxCount: 1 }, { name: 'passport_doc', maxCount: 1 },
  { name: 'bank_confirm_doc', maxCount: 1 }, { name: 'bank_statements_doc', maxCount: 1 },
  { name: 'address_proof_doc', maxCount: 1 }
];

router.post('/upload-docs', upload.fields(docFields), async (req, res) => {
  try {
    const { phone } = req.body;
    const client = clientsDB.findByPhone(phone);
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

    const docTypeMap = {
      poa_doc: 'ייפוי_כח', apostille_doc: 'אפוסטיל', payslips_doc: 'תלושי_שכר',
      passport_doc: 'דרכון', bank_confirm_doc: 'אישור_בנק',
      bank_statements_doc: 'תדפיסי_בנק', address_proof_doc: 'הוכחת_כתובת'
    };

    let folderResult = { success: false };
    try {
      folderResult = await createClientFolder(`${client.first_name} ${client.last_name}`, phone, process.env.DRIVE_FOLDER_CLIENTS);
    } catch (e) { console.warn('Drive folder failed:', e.message); }

    for (const [fieldName, docType] of Object.entries(docTypeMap)) {
      const files = req.files?.[fieldName];
      if (files && files[0]) {
        const file = files[0];
        let driveResult = { success: false };
        try {
          if (folderResult.success)
            driveResult = await uploadFile(file.path, `${docType}_${client.first_name}_${client.last_name}.pdf`, 'application/pdf', folderResult.folderId);
        } catch (e) { console.warn('Drive upload failed:', e.message); }

        docsDB.add({ client_id: client.id, doc_type: docType, original_name: file.originalname, drive_file_id: driveResult.fileId || null, drive_url: driveResult.webViewLink || null });
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    clientsDB.updateStep(client.id, 9);
    sendMessage(phone, MESSAGES.DOCS_UPLOADED(client.first_name, 'הכתובת המלאה תימסר בנפרד'), client.id)
      .catch(e => console.warn('WA:', e.message));

    sendAdminNotification(`📄 מסמכים הועלו!\nשם: ${client.first_name} ${client.last_name}\nטלפון: ${phone}\n\nיש להוריד את המסמכים מפאנל הניהול.`).catch(e => console.warn('Admin WA:', e.message));

    res.json({ success: true, current_step: 9 });
  } catch (err) {
    console.error('Upload docs error:', err);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/client/tracking
router.post('/tracking', (req, res) => {
  const { phone, tracking_number, shipping_company } = req.body;
  const client = clientsDB.findByPhone(phone);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { tracking_number, shipping_company, current_step: 10 });
  sendMessage(phone, MESSAGES.TRACKING_RECEIVED(client.first_name), client.id)
    .catch(e => console.warn('WA:', e.message));

  res.json({ success: true, current_step: 10 });
});

// POST /api/client/feedback
router.post('/feedback', async (req, res) => {
  const { phone, account_opened, service_rating, response_rating, accessibility_rating, recommend_rating, comment } = req.body;
  const client = clientsDB.findByPhone(phone);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  const ratings = {
    service_rating: parseInt(service_rating),
    response_rating: parseInt(response_rating),
    accessibility_rating: parseInt(accessibility_rating),
    recommend_rating: parseInt(recommend_rating)
  };

  for (const [key, val] of Object.entries(ratings)) {
    if (isNaN(val) || val < 1 || val > 5) {
      return res.status(400).json({ error: 'דירוג לא תקין' });
    }
  }

  feedbackDB.add({
    client_id: client.id, account_opened: account_opened ? 1 : 0,
    ...ratings, comment
  });

  clientsDB.update(client.id, { current_step: 13, status: 'completed' });

  sendMessage(client.phone, MESSAGES.CONGRATULATIONS(client.first_name), client.id).catch(e => console.warn('WA:', e.message));

  res.json({ success: true, message: 'תודה על המשוב!', current_step: 13 });
});

module.exports = router;
