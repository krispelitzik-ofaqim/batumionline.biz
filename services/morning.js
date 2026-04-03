const axios = require('axios');

const MORNING_API_URL = process.env.MORNING_API_URL || 'https://api.icount.co.il/api/v3.php';
const MORNING_API_KEY = process.env.MORNING_API_KEY;
const PAYMENT_AMOUNT = process.env.PAYMENT_AMOUNT || 1900;

async function createPaymentLink(client) {
  try {
    const response = await axios.post(MORNING_API_URL, {
      api_key: MORNING_API_KEY,
      action: 'doc_create',
      doc_type: 'invrec',
      client_name: `${client.first_name} ${client.last_name}`,
      client_phone: client.phone,
      client_email: client.email,
      items: [{
        description: 'פתיחת חשבון בנק בגאורגיה - שירות מלא',
        price: PAYMENT_AMOUNT,
        quantity: 1,
        vat_type: 0
      }],
      currency: 'ILS',
      lang: 'he'
    });

    if (response.data && response.data.status) {
      return {
        success: true,
        paymentUrl: response.data.url || response.data.payment_url,
        docId: response.data.doc_id
      };
    }

    return { success: false, error: 'Morning API error' };
  } catch (error) {
    console.error('Morning payment error:', error.message);
    return { success: false, error: error.message };
  }
}

async function verifyPayment(docId) {
  try {
    const response = await axios.post(MORNING_API_URL, {
      api_key: MORNING_API_KEY,
      action: 'doc_get',
      doc_id: docId
    });

    return {
      success: true,
      paid: response.data?.paid || false,
      data: response.data
    };
  } catch (error) {
    console.error('Morning verify error:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { createPaymentLink, verifyPayment };
