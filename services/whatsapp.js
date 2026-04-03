const axios = require('axios');
const { whatsappLogDB } = require('../database/db');

const BASE_URL = process.env.GREEN_API_URL;
const INSTANCE = process.env.GREEN_API_INSTANCE;
const TOKEN = process.env.GREEN_API_TOKEN;

const MESSAGES = {
  STEP1_RECEIVED: (name) => `שלום ${name} 👋\n\nקיבלנו את פרטיך ואת הדרכון שלך לבדיקה.\nאנו נחזור אליך בהקדם עם תשובה.\n\n*Batumionline* 🏦`,
  
  PASSPORT_APPROVED: (name, link) => `שלום ${name} ✅\n\nבדיקת הנאותות אושרה בהצלחה!\nכעת תוכל להמשיך לשלב התשלום.\n\n👉 לחץ כאן להמשך:\n${link}\n\n*Batumionline* 🏦`,
  
  PASSPORT_REJECTED: (name) => `שלום ${name} ❌\n\nלצערנו, הדרכון שהעלית לא אושר.\nניתן לנסות שוב בעוד 60 יום עם דרכון בתוקף.\n\nלשאלות ניתן לפנות אלינו.\n\n*Batumionline* 🏦`,
  
  PAYMENT_RECEIVED: (name, link) => `שלום ${name} 💳\n\nהתשלום התקבל בהצלחה!\nאנו מכינים את מסמכי ייפוי הכוח עבורך.\n\n👉 לחץ כאן להמשך:\n${link}\n\n*Batumionline* 🏦`,
  
  CHECKLIST_DONE: (name, link) => `שלום ${name} 📋\n\nמעולה! סיימת את צ'ק ליסט המסמכים.\nכעת יש להעלות את המסמכים הסרוקים למערכת.\n\n👉 לחץ כאן להמשך:\n${link}\n\n*Batumionline* 🏦`,
  
  DOCS_UPLOADED: (name, address) => `שלום ${name} 📄\n\nהמסמכים התקבלו בהצלחה!\nשלב הבא: שלח את המסמכים המקוריים בדואר מהיר לכתובת:\n\n📍 ${address || 'כתובת עורך הדין תימסר בנפרד'}\n\nלאחר השליחה חזור לאפליקציה והזן את מספר המשלוח.\n\n*Batumionline* 🏦`,
  
  TRACKING_RECEIVED: (name) => `שלום ${name} 📦\n\nמספר המשלוח התקבל, תודה!\nנעדכן אותך ברגע שהמסמכים יגיעו לגאורגיה.\n\n*Batumionline* 🏦`,
  
  DOCS_ARRIVED: (name, link) => `שלום ${name} 📬\n\nהמסמכים הגיעו לגאורגיה!\nעורך הדין שלנו כעת מטפל בפתיחת החשבון.\nנעדכן אותך ברגע שהחשבון ייפתח.\n\n👉 לצפייה בסטטוס:\n${link}\n\n*Batumionline* 🏦`,
  
  ACCOUNT_OPENED: (name, link) => `שלום ${name} 🎉\n\nמזל טוב! חשבון הבנק שלך בגאורגיה נפתח בהצלחה!\n\nהבנק ישלח אליך הודעת SMS עם פרטי הכניסה.\nניתן להוריד את אפליקציית הבנק ולנהל את חשבונך.\n\n👉 לחץ להמשך:\n${link}\n\n*Batumionline* 🏦`
};

async function sendMessage(phone, message, clientId = null) {
  try {
    // Format phone: ensure it starts with 972 for Israeli numbers
    let formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '972' + formattedPhone.slice(1);
    if (!formattedPhone.startsWith('972') && formattedPhone.length === 9) formattedPhone = '972' + formattedPhone;
    
    const chatId = `${formattedPhone}@c.us`;
    
    const url = `${BASE_URL}/waInstance${INSTANCE}/sendMessage/${TOKEN}`;
    const response = await axios.post(url, {
      chatId,
      message
    });

    whatsappLogDB.add({
      client_id: clientId,
      phone: formattedPhone,
      message,
      status: 'sent'
    });

    return { success: true, data: response.data };
  } catch (error) {
    console.error('WhatsApp send error:', error.message);
    
    whatsappLogDB.add({
      client_id: clientId,
      phone,
      message,
      status: 'failed'
    });

    return { success: false, error: error.message };
  }
}

module.exports = { sendMessage, MESSAGES };
