const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { lawyerAuth } = require('../middleware/auth');
const { clientsDB, docsDB } = require('../database/db');
const { sendMessage, MESSAGES } = require('../services/whatsapp');
const { uploadFile, createClientFolder } = require('../services/drive');
const { UPLOADS_DIR } = require('../helpers/storage');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const poaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'temp');
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
    else cb(new Error('Only PDF files allowed'));
  }
});

router.use(lawyerAuth);

// GET /api/lawyer/clients - clients from passport-review stage onward (so the lawyer can review/approve passports too)
router.get('/clients', (req, res) => {
  const allClients = clientsDB.getAll();
  const relevantClients = allClients.filter(c => c.current_step >= 2 && !c.trashed && !c.archived);
  // Enrich with docs info
  const enriched = relevantClients.map(c => {
    const docs = docsDB.getByClient(c.id);
    const poaDoc = docs.find(d => d.doc_type === 'poa_to_sign' || d.doc_type === 'poa_to_sign_drive');
    return {
      ...c,
      has_poa: poaDoc ? true : false,
      poa_uploaded_by: poaDoc ? (poaDoc.uploaded_by || '-') : null
    };
  });
  res.json({ success: true, clients: enriched });
});

// POST /api/lawyer/passport/approve - lawyer approves the passport (moves client to payment)
router.post('/passport/approve', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const token = req.headers['x-lawyer-token'];
  const actor = token === process.env.ADMIN_PASSWORD ? 'admin' : 'lawyer';
  const paymentUrl = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;

  clientsDB.update(client.id, { passport_status: 'approved', current_step: 4, passport_approved_by: actor, passport_approved_at: new Date().toISOString() });
  await sendMessage(client.phone, MESSAGES.PASSPORT_APPROVED(client.first_name, paymentUrl), client.id);

  res.json({ success: true, message: 'Passport approved' });
});

// POST /api/lawyer/passport/reject - lawyer rejects the passport (client notified, may retry later)
router.post('/passport/reject', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  clientsDB.update(client.id, { passport_status: 'rejected', current_step: 2 });
  await sendMessage(client.phone, MESSAGES.PASSPORT_REJECTED(client.first_name), client.id);

  res.json({ success: true, message: 'Passport rejected' });
});

// POST /api/lawyer/upload-poa/:clientId - upload POA document
router.post('/upload-poa/:clientId', poaUpload.single('poa_file'), async (req, res) => {
  try {
    const client = clientsDB.findById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!req.file) return res.status(400).json({ error: 'No file selected' });

    const localDir = path.join(UPLOADS_DIR, 'poa');
    fs.mkdirSync(localDir, { recursive: true });
    const savedName = `poa_${client.id}_${Date.now()}.pdf`;
    const savedPath = path.join(localDir, savedName);
    fs.renameSync(req.file.path, savedPath);
    const localUrl = `/uploads/poa/${savedName}`;

    docsDB.add({ client_id: client.id, doc_type: 'poa_to_sign', uploaded_by: 'lawyer', original_name: req.file.originalname, drive_file_id: null, drive_url: localUrl });

    let driveUrl = null;
    try {
      const folderResult = await createClientFolder(`${client.first_name} ${client.last_name}`, client.phone, process.env.DRIVE_FOLDER_CLIENTS);
      if (folderResult.success) {
        const up = await uploadFile(savedPath, `poa_${client.first_name}_${client.last_name}.pdf`, 'application/pdf', folderResult.folderId);
        if (up.success) {
          driveUrl = up.webViewLink;
          docsDB.add({ client_id: client.id, doc_type: 'poa_to_sign_drive', uploaded_by: 'lawyer', original_name: req.file.originalname, drive_file_id: up.fileId, drive_url: up.webViewLink });
        }
      }
    } catch (e) { console.warn('Drive POA upload skipped:', e.message); }

    clientsDB.update(client.id, { poa_uploaded_at: new Date().toISOString() });
    res.json({ success: true, message: 'Power of Attorney uploaded', localUrl, driveUrl });
  } catch (err) {
    console.error('POA upload error:', err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/lawyer/mark-step - mark a lawyer step as done
router.post('/mark-step', (req, res) => {
  const { client_id, step } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (step < 1 || step > 4) return res.status(400).json({ error: 'Invalid step' });

  const update = {};
  update['lawyer_step' + step] = 1;
  clientsDB.update(client.id, update);
  res.json({ success: true });
});

// POST /api/lawyer/docs-received - mark docs as received
router.post('/docs-received', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const token = req.headers['x-lawyer-token'];
  const actor = token === process.env.ADMIN_PASSWORD ? 'admin' : 'lawyer';
  clientsDB.update(client.id, { docs_received: 1, current_step: 11, lawyer_step3: 1, docs_received_by: actor, docs_received_at: new Date().toISOString() });

  const link = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;
  await sendMessage(client.phone, MESSAGES.DOCS_ARRIVED(client.first_name, link), client.id);

  res.json({ success: true, message: 'Updated — originals received' });
});

// POST /api/lawyer/account-opened - mark account as opened
router.post('/account-opened', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const token = req.headers['x-lawyer-token'];
  const actor = token === process.env.ADMIN_PASSWORD ? 'admin' : 'lawyer';
  clientsDB.update(client.id, { account_opened: 1, current_step: 12, lawyer_step4: 1, account_opened_by: actor, account_opened_at: new Date().toISOString() });

  const link = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;
  await sendMessage(client.phone, MESSAGES.ACCOUNT_OPENED(client.first_name, link), client.id);

  res.json({ success: true, message: 'Updated — account opened! Client notified' });
});

// GET /api/lawyer/client/:id/docs - get client docs
router.get('/client/:id/docs', (req, res) => {
  const docs = docsDB.getByClient(req.params.id);
  res.json({ success: true, docs });
});

// GET /api/lawyer/client/:id/download-docs - download all docs as ZIP
router.get('/client/:id/download-docs', (req, res) => {
  const archiver = require('archiver');
  const client = clientsDB.findById(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const docs = docsDB.getByClient(client.id);
  const localDocs = docs.filter(d => d.drive_url && d.drive_url.startsWith('/uploads/'));

  if (localDocs.length === 0) {
    return res.status(404).json({ error: 'No documents to download' });
  }

  const zipName = `docs_${client.first_name}_${client.last_name}_${client.id}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { res.status(500).send({ error: err.message }); });
  archive.pipe(res);

  localDocs.forEach(d => {
    const filePath = path.join(__dirname, '..', d.drive_url);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const name = (d.doc_type || 'doc') + '_' + client.id + ext;
      archive.file(filePath, { name });
    }
  });

  archive.finalize();

  // Mark docs as downloaded
  const token = req.query.token || req.headers['x-lawyer-token'];
  const actor = token === process.env.ADMIN_PASSWORD ? 'admin' : 'lawyer';
  clientsDB.update(client.id, { docs_downloaded: 1, docs_downloaded_by: actor, docs_downloaded_at: new Date().toISOString() });
});

module.exports = router;
