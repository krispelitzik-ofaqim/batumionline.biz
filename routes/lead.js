const express = require('express');
const router = express.Router();
const { leadsDB } = require('../database/db');
const { sendMessage, sendAdminNotification, MESSAGES } = require('../services/whatsapp');

// POST /api/lead — capture a guide lead (name + phone) from the landing page,
// send the guide via WhatsApp immediately, and notify admin.
router.post('/', async (req, res) => {
  try {
    const name = (req.body.name || '').toString().trim().slice(0, 80);
    const phoneRaw = (req.body.phone || '').toString().trim();
    const digits = phoneRaw.replace(/\D/g, '');

    if (!name || digits.length < 9) {
      return res.status(400).json({ success: false, error: 'שם וטלפון תקין נדרשים' });
    }

    const lead = leadsDB.create({ name, phone: phoneRaw, source: (req.body.source || 'guide-lp') });

    // Immediate WhatsApp with the guide link (fire-and-forget; don't block the response)
    sendMessage(phoneRaw, MESSAGES.GUIDE_SENT(name), null).catch(() => {});
    sendAdminNotification(MESSAGES.GUIDE_LEAD_ADMIN(name, phoneRaw, lead.created_at)).catch(() => {});

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
