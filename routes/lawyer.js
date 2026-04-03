const express = require('express');
const router = express.Router();
const { lawyerAuth } = require('../middleware/auth');
const { clientsDB, docsDB } = require('../database/db');
const { sendMessage, MESSAGES } = require('../services/whatsapp');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

router.use(lawyerAuth);

// GET /api/lawyer/clients - get clients in shipping/docs stages
router.get('/clients', (req, res) => {
  const allClients = clientsDB.getAll();
  // Lawyer only sees clients in step 10+ (tracking submitted)
  const relevantClients = allClients.filter(c => c.current_step >= 10);
  res.json({ success: true, clients: relevantClients });
});

// POST /api/lawyer/docs-received - mark docs as received
router.post('/docs-received', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { docs_received: 1, current_step: 11 });

  const link = `${APP_URL}/client?phone=${encodeURIComponent(client.phone)}`;
  await sendMessage(client.phone, MESSAGES.DOCS_ARRIVED(client.first_name, link), client.id);

  res.json({ success: true, message: 'עודכן - מסמכים הגיעו' });
});

// POST /api/lawyer/account-opened - mark account as opened
router.post('/account-opened', async (req, res) => {
  const { client_id } = req.body;
  const client = clientsDB.findById(client_id);
  if (!client) return res.status(404).json({ error: 'לקוח לא נמצא' });

  clientsDB.update(client.id, { account_opened: 1, current_step: 12 });

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
