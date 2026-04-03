const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const { clientsDB, docsDB, checklistDB } = require('../database/db');
const { sendMessage, MESSAGES } = require('../services/whatsapp');
const { createPaymentLink } = require('../services/morning');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

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

module.exports = router;
