const express = require('express');
const axios = require('axios');
const { sendAdminNotification } = require('../services/whatsapp');

const router = express.Router();

const MODE = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
const API_BASE = MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_SECRET;
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;

// Get an OAuth access token from PayPal
async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64');
  const res = await axios.post(
    `${API_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  return res.data.access_token;
}

// Verify a webhook event really came from PayPal (not a forged request)
async function verifyWebhook(req, token) {
  const res = await axios.post(
    `${API_BASE}/v1/notifications/verify-webhook-signature`,
    {
      auth_algo: req.headers['paypal-auth-algo'],
      cert_url: req.headers['paypal-cert-url'],
      transmission_id: req.headers['paypal-transmission-id'],
      transmission_sig: req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id: WEBHOOK_ID,
      webhook_event: req.body,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.verification_status === 'SUCCESS';
}

// POST /api/paypal/webhook — PayPal notifies us when a payment is captured
router.post('/webhook', async (req, res) => {
  // Acknowledge immediately so PayPal does not retry
  res.status(200).json({ received: true });

  try {
    const event = req.body || {};
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return;

    // Validate authenticity (skip only if webhook id not configured yet)
    if (WEBHOOK_ID && WEBHOOK_ID !== 'REPLACE_AFTER_CREATING_WEBHOOK') {
      const token = await getAccessToken();
      const ok = await verifyWebhook(req, token);
      if (!ok) {
        console.warn('PayPal webhook verification failed — ignoring');
        return;
      }
    }

    const r = event.resource || {};
    const amount = r.amount ? `${r.amount.value} ${r.amount.currency_code}` : '-';
    const payer = r.payer || {};
    const payerName = payer.name
      ? `${payer.name.given_name || ''} ${payer.name.surname || ''}`.trim()
      : '';
    const payerEmail = payer.email_address || '';
    const who = [payerName, payerEmail].filter(Boolean).join(' / ') || 'לא ידוע';
    const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

    sendAdminNotification(
      `💰 התקבל תשלום ב-PayPal!\nסכום: ${amount}\nמשלם: ${who}\nזמן: ${now}\n\nאתר את הלקוח בפאנל ולחץ "אשר תשלום ידנית".`
    ).catch((e) => console.warn('Admin WA:', e.message));
  } catch (err) {
    console.error('PayPal webhook error:', err.message);
  }
});

module.exports = router;
