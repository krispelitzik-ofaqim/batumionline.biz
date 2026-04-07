const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { lawyerAuth } = require('../middleware/auth');
const { clientsDB, docsDB } = require('../database/db');
const { sendMessage, MESSAGES } = require('../services/whatsapp');
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

router.use(lawyerAuth);

// GET /api/lawyer/clients - get clients in relevant stages (step 9+)
router.get('/clients', (req, res) => {
  const allClients = clientsDB.getAll();
  const relevantClients = allClients.filter(c => c.current_step >= 9 && !c.trashed && !c.archived);
  res.json({ success: true, clients: relevantClients });
});

// POST /api/lawyer/upload-poa/:clientId - upload POA document
router.post('/upload-poa/:clientId', poaUpload.single('poa_file'), async (req, res) => {
  try {
    const client = clientsDB.findById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });
    if (!req.file) return res.status(400).json({ error: 'לא נבחר קובץ' });

    const localDir = path.join(__dirname, '..', 'uploads', 'poa');
    fs.mkdirSync(localDir, { recursive: true });
    const savedName = `poa_${client.id}_${Date.now()}.pdf`;
    const savedPath = path.join(localDir, savedName);
    fs.renameSync(req.file.path, savedPath);
    const localUrl = `/uploads/poa/${savedName}`;

    docsDB.add({ client_id: client.id, doc_type: 'poa_to_sign', original_name: req.file.originalname, drive_file_id: null, drive_url: localUrl });

    let driveUrl = null;
    try {
      const folderResult = await createClientFolder(`${client.first_name} ${client.last_name}`, client.phone, process.env.DRIVE_FOLDER_POA);
      if (folderResult.success) {
        const up = await uploadFile(savedPath, `poa_${client.first_name}_${client.last_name}.pdf`, 'application/pdf', folderResult.folderId);
        if (up.success) {
          driveUrl = up.webViewLink;
          docsDB.add({ client_id: client.id, doc_type: 'poa_to_sign_drive', original_name: req.file.originalname, drive_file_id: up.fileId, drive_url: up.webViewLink });
        }
      }
    } catch (e) { console.warn('Drive POA upload skipped:', e.message); }

    res.json({ success: true, message: 'ייפוי כח הועלה', localUrl, driveUrl });
  } catch (err) {
    console.error('POA upload error:', err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/lawyer/mark-step - mark a lawyer step as done
router.post('/mark-step', (req, res) => {
  const { client_id, step } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });
  if (step < 1 || step > 4) return res.status(400).json({ error: 'שלב לא תקין' });

  const update = {};
  update['lawyer_step' + step] = 1;
  clientsDB.update(client.id, update);
  res.json({ success: true });
});

// POST /api/lawyer/docs-received - mark docs as received
router.post('/docs-received', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { docs_received: 1, current_step: 11, lawyer_step3: 1 });

  const link = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;
  await sendMessage(client.phone, MESSAGES.DOCS_ARRIVED(client.first_name, link), client.id);

  res.json({ success: true, message: 'עודכן - מסמכים הגיעו' });
});

// POST /api/lawyer/account-opened - mark account as opened
router.post('/account-opened', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { account_opened: 1, current_step: 12, lawyer_step4: 1 });

  const link = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;
  await sendMessage(client.phone, MESSAGES.ACCOUNT_OPENED(client.first_name, link), client.id);

  res.json({ success: true, message: 'עודכן - חשבון נפתח! הלקוח קיבל הודעה' });
});

// GET /api/lawyer/client/:id/docs - get client docs
router.get('/client/:id/docs', (req, res) => {
  const docs = docsDB.getByClient(req.params.id);
  res.json({ success: true, docs });
});

module.exports = router;
