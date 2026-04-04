// ===== STATE =====
let clientPhone = '';
let clientStep = 1;
let selectedBank = '';
let selectedShipper = '';
let checklistChecked = 0;

const DOC_TYPES = [
  { key: 'poa_doc', label: 'ייפוי כח נוטוריוני חתום', hint: 'PDF בלבד' },
  { key: 'apostille_doc', label: 'אפוסטיל', hint: 'מסמך ייחודי מהנוטוריון' },
  { key: 'payslips_doc', label: '3 תלושי שכר (קובץ אחד)', hint: 'מאוחדים לקובץ PDF אחד' },
  { key: 'passport_doc', label: 'דרכון סרוק (עמודים 2-3)', hint: 'צבעוני, PDF' },
  { key: 'bank_confirm_doc', label: 'אישור ניהול חשבון בנק', hint: 'באנגלית עם חותמת' },
  { key: 'bank_statements_doc', label: 'תדפיסי בנק 6 חודשים', hint: 'עובר ושב' },
  { key: 'address_proof_doc', label: 'הוכחת כתובת', hint: 'חשמל / ארנונה / כבלים' }
];

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  // Check URL params
  const params = new URLSearchParams(window.location.search);
  const phoneParam = params.get('phone');

  if (phoneParam) {
    clientPhone = phoneParam;
    checkPhone(phoneParam);
  }

  // Build doc upload fields
  buildDocUploads();
});

// ===== SCREEN NAVIGATION =====
function showScreen(id) {
  document.querySelectorAll('.panel-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showProgress(visualStep) {
  document.getElementById('progress-bar').style.display = 'block';
  const allDone = visualStep >= 7;
  for (let i = 1; i <= 7; i++) {
    const el = document.getElementById(`ps-${i}`);
    el.classList.remove('active', 'completed');
    if (allDone || i < visualStep) el.classList.add('completed');
    else if (i === visualStep) el.classList.add('active');
  }
}

function showLoading(show) {
  document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

// ===== PHONE CHECK =====
async function checkPhone(phone) {
  const p = phone || document.getElementById('phone-input').value.trim();
  if (!p) return;

  clientPhone = formatPhone(p);
  showLoading(true);

  try {
    const res = await fetch(`/api/client/status?phone=${encodeURIComponent(clientPhone)}`);
    const data = await res.json();
    showLoading(false);

    if (data.blocked) {
      const days = data.days_left || 60;
      document.getElementById('block-info').innerHTML = `
        <strong>${data.block_reason || 'הדרכון לא אושר'}</strong><br/>
        ניתן לנסות שוב בעוד <strong>${days} ימים</strong>
      `;
      showScreen('screen-blocked');
      return;
    }

    if (data.trashed) {
      showScreen('screen-trashed');
      return;
    }

    if (!data.exists) {
      showScreen('screen-register');
      document.getElementById('r-phone').value = p;
      return;
    }

    // Route to correct screen
    routeToStep(data.current_step, data);
  } catch (e) {
    showLoading(false);
    document.getElementById('phone-error').textContent = 'שגיאת חיבור. נסה שנית.';
    document.getElementById('phone-error').style.display = 'flex';
  }
}

function routeToStep(step, data = {}) {
  clientStep = step;
  document.getElementById('client-phone-display').textContent = `📱 ${clientPhone}`;

  if (step <= 2) {
    showProgress(2);
    document.getElementById('waiting-phone').textContent = clientPhone;
    showScreen('screen-waiting-passport');
  } else if (step === 4) {
    showProgress(3);
    showScreen('screen-payment');
  } else if (step === 5 || step === 6) {
    showProgress(4);
    showScreen('screen-notary');
  } else if (step === 7) {
    showProgress(5);
    showScreen('screen-checklist');
  } else if (step === 8) {
    showProgress(5);
    showScreen('screen-upload-docs');
  } else if (step === 9) {
    showProgress(6);
    showScreen('screen-shipping');
  } else if (step === 10) {
    showProgress(6);
    document.getElementById('tracking-display').textContent = data.tracking_number || '';
    showScreen('screen-waiting-delivery');
  } else if (step === 11) {
    showProgress(7);
    showScreen('screen-bank-process');
  } else if (step === 12) {
    showProgress(7);
    showScreen('screen-feedback');
  } else if (step >= 13) {
    showProgress(7);
    showScreen('screen-complete');
  }
}

// ===== REGISTER =====
async function submitRegister() {
  const fname = document.getElementById('r-fname').value.trim();
  const lname = document.getElementById('r-lname').value.trim();
  const email = document.getElementById('r-email').value.trim();
  const phone = document.getElementById('r-phone').value.trim();
  const passportFile = document.getElementById('passport-file').files[0];

  if (!fname || !lname || !email || !phone) {
    showError('register-error', 'נא למלא את כל שדות החובה');
    return;
  }

  if (!passportFile) {
    showError('register-error', 'יש להעלות קובץ דרכון');
    return;
  }

  clientPhone = formatPhone(phone);

  const formData = new FormData();
  formData.append('phone', clientPhone);
  formData.append('first_name', fname);
  formData.append('last_name', lname);
  formData.append('email', email);
  formData.append('id_number', document.getElementById('r-id').value.trim());
  formData.append('birth_date', document.getElementById('r-dob').value);
  formData.append('passport_number', document.getElementById('r-passport-num').value.trim());
  formData.append('passport_name_en', document.getElementById('r-fname-en').value.trim());
  formData.append('passport_surname_en', document.getElementById('r-lname-en').value.trim());
  formData.append('passport_valid', document.querySelector('input[name="passport_valid"]:checked')?.value || 'true');
  formData.append('preferred_bank', selectedBank);
  formData.append('passport_file', passportFile);

  const btn = document.getElementById('btn-register');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> שולח...';
  showLoading(true);

  try {
    const res = await fetch('/api/client/register', { method: 'POST', body: formData });
    const data = await res.json();
    showLoading(false);
    btn.disabled = false;
    btn.innerHTML = 'שלח ועבור לבדיקת נאותות';

    if (data.success) {
      document.getElementById('client-phone-display').textContent = `📱 ${clientPhone}`;
      document.getElementById('waiting-phone').textContent = clientPhone;
      showProgress(2);
      showScreen('screen-waiting-passport');
    } else {
      showError('register-error', data.error || 'שגיאה בשליחה');
    }
  } catch (e) {
    showLoading(false);
    btn.disabled = false;
    btn.innerHTML = 'שלח ועבור לבדיקת נאותות';
    showError('register-error', 'שגיאת חיבור. נסה שנית.');
  }
}

// ===== PAYMENT =====
async function goToPayment() {
  // Temporary: skip payment until Morning is configured
  const btn = document.getElementById('btn-pay');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> מעבד...';

  try {
    const res = await fetch('/api/client/temp-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: clientPhone })
    });
    const data = await res.json();
    if (data.success) {
      clientData.current_step = data.current_step;
      renderStep();
    } else {
      alert(data.error || 'שגיאה');
      btn.disabled = false;
      btn.innerHTML = '➡️ המשך לשלב הבא';
    }
  } catch (err) {
    alert('שגיאת תקשורת');
    btn.disabled = false;
    btn.innerHTML = '➡️ המשך לשלב הבא';
  }
}

// ===== NOTARY =====
async function notaryDone() {
  showLoading(true);
  try {
    const res = await fetch('/api/client/checklist-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: clientPhone })
    });
    const data = await res.json();
    showLoading(false);
    if (data.success) {
      clientStep = data.current_step;
      if (clientData) clientData.current_step = data.current_step;
      showProgress(5);
      showScreen('screen-checklist');
    } else {
      alert(data.error || 'שגיאה');
    }
  } catch (e) {
    showLoading(false);
    alert('שגיאת תקשורת');
  }
}

async function downloadPOA() {
  // Try to fetch client's uploaded POA from server
  try {
    const res = await fetch(`/api/client/poa?phone=${encodeURIComponent(clientPhone)}`);
    const data = await res.json();
    if (data.success && data.url) {
      window.open(data.url, '_blank');
      return;
    }
  } catch (e) {}
  alert('ייפוי הכח עדיין לא הועלה. אנא המתן לעדכון מהמנהל.');
}

// ===== CHECKLIST =====
function toggleCheck(id, ev) {
  const cb = document.getElementById(id);
  // When called from the parent div click, manually toggle the checkbox
  // When called from the checkbox onchange, it already toggled itself
  if (ev) {
    cb.checked = !cb.checked;
  }
  const item = cb.closest('.checklist-item');
  item.classList.toggle('checked', cb.checked);
  updateChecklistProgress();
}

function updateChecklistProgress() {
  const checked = document.querySelectorAll('.checklist-item input:checked').length;
  checklistChecked = checked;
  const fill = (checked / 7 * 100).toFixed(0);
  document.getElementById('checklist-fill').style.width = fill + '%';
  document.getElementById('checklist-count').textContent = `${checked} מתוך 7 מסמכים מוכנים`;
  document.getElementById('btn-checklist').disabled = checked < 7;
}

async function submitChecklist() {
  const body = {
    phone: clientPhone,
    poa_ready: document.getElementById('chk-poa').checked,
    apostille_ready: document.getElementById('chk-apostille').checked,
    payslips_ready: document.getElementById('chk-payslips').checked,
    passport_ready: document.getElementById('chk-passport').checked,
    bank_confirm_ready: document.getElementById('chk-bank-confirm').checked,
    bank_statements_ready: document.getElementById('chk-statements').checked,
    address_proof_ready: document.getElementById('chk-address').checked
  };

  showLoading(true);
  try {
    const res = await fetch('/api/client/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    showLoading(false);
    if (data.success) {
      showProgress(5);
      showScreen('screen-upload-docs');
    }
  } catch (e) {
    showLoading(false);
  }
}

// ===== DOCUMENT UPLOADS =====
function buildDocUploads() {
  const container = document.getElementById('doc-uploads');
  container.innerHTML = DOC_TYPES.map(doc => `
    <div class="form-group" id="dg-${doc.key}">
      <label class="form-label">${doc.label}</label>
      <div class="upload-zone" id="zone-${doc.key}" onclick="document.getElementById('file-${doc.key}').click()">
        <span class="upload-icon">📄</span>
        <div id="zt-${doc.key}">לחץ להעלאת קובץ PDF</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${doc.hint}</div>
      </div>
      <input type="file" id="file-${doc.key}" accept=".pdf" style="display:none;"
        onchange="handleFileSelect(this,'zone-${doc.key}','zt-${doc.key}')" />
    </div>
  `).join('');
}

async function submitDocs() {
  const formData = new FormData();
  formData.append('phone', clientPhone);

  let missing = [];
  for (const doc of DOC_TYPES) {
    const file = document.getElementById(`file-${doc.key}`)?.files[0];
    if (!file) { missing.push(doc.label); }
    else formData.append(doc.key, file);
  }

  if (missing.length > 0) {
    showError('upload-error', `חסרים מסמכים: ${missing.join(', ')}`);
    return;
  }

  hideError('upload-error');
  const btn = document.getElementById('btn-upload-docs');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> מעלה מסמכים...';
  document.getElementById('upload-progress').style.display = 'block';

  // Simulate progress
  let prog = 0;
  const interval = setInterval(() => {
    prog = Math.min(prog + 8, 90);
    document.getElementById('upload-fill').style.width = prog + '%';
  }, 300);

  try {
    const res = await fetch('/api/client/upload-docs', { method: 'POST', body: formData });
    const data = await res.json();
    clearInterval(interval);
    document.getElementById('upload-fill').style.width = '100%';
    document.getElementById('upload-status').textContent = 'המסמכים הועלו בהצלחה!';

    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '📤 העלה את כל המסמכים';
      document.getElementById('upload-progress').style.display = 'none';
      if (data.success) {
        showProgress(6);
        showScreen('screen-shipping');
      }
    }, 800);
  } catch (e) {
    clearInterval(interval);
    btn.disabled = false;
    btn.innerHTML = '📤 העלה את כל המסמכים';
    showError('upload-error', 'שגיאה בהעלאה. נסה שנית.');
  }
}

// ===== TRACKING =====
async function submitTracking() {
  const tracking = document.getElementById('tracking-number').value.trim();
  if (!tracking) { showError('shipping-error', 'יש להזין מספר משלוח'); return; }
  if (!selectedShipper) { showError('shipping-error', 'יש לבחור חברת שילוח'); return; }

  hideError('shipping-error');
  showLoading(true);

  try {
    const res = await fetch('/api/client/tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: clientPhone, tracking_number: tracking, shipping_company: selectedShipper })
    });
    const data = await res.json();
    showLoading(false);
    if (data.success) {
      document.getElementById('tracking-display').textContent = tracking;
      showProgress(6);
      showScreen('screen-waiting-delivery');
    }
  } catch (e) {
    showLoading(false);
    showError('shipping-error', 'שגיאת חיבור. נסה שנית.');
  }
}

// ===== FEEDBACK =====
async function submitFeedback() {
  const service = document.querySelector('input[name="service_rating"]:checked')?.value;
  const response = document.querySelector('input[name="response_rating"]:checked')?.value;
  const accessibility = document.querySelector('input[name="accessibility_rating"]:checked')?.value;
  const recommend = document.querySelector('input[name="recommend_rating"]:checked')?.value;
  const comment = document.getElementById('feedback-comment').value.trim();
  const accountOpened = document.querySelector('input[name="account_opened"]:checked')?.value;

  if (!service || !response || !accessibility || !recommend) {
    showError('feedback-error', 'נא לדרג את כל הסעיפים');
    return;
  }

  showLoading(true);
  try {
    const res = await fetch('/api/client/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: clientPhone,
        account_opened: accountOpened,
        service_rating: service,
        response_rating: response,
        accessibility_rating: accessibility,
        recommend_rating: recommend,
        comment
      })
    });
    const data = await res.json();
    showLoading(false);
    if (data.success) {
      showProgress(7);
      showScreen('screen-complete');
    }
  } catch (e) {
    showLoading(false);
  }
}

// ===== UI HELPERS =====
function handleFileSelect(input, zoneId, textId) {
  const file = input.files[0];
  if (file) {
    document.getElementById(textId).textContent = `✅ ${file.name}`;
    document.getElementById(zoneId).classList.add('uploaded');
  }
}

function selectBank(bank) {
  selectedBank = bank;
  document.getElementById('bank-bog').classList.toggle('selected', bank === 'BOG');
  document.getElementById('bank-tbc').classList.toggle('selected', bank === 'TBC');
}

function selectShipping(el, company) {
  selectedShipper = company;
  document.querySelectorAll('#shipping-company-group .radio-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

function selectRadio(activeId, inactiveId) {
  document.getElementById(activeId).classList.add('selected');
  document.getElementById(inactiveId).classList.remove('selected');
}

function selectDeclaration(val) {
  document.getElementById('declare-yes').classList.toggle('selected', val === 'yes');
  document.getElementById('declare-no').classList.toggle('selected', val === 'no');
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'flex'; }
}

function hideError(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function formatPhone(phone) {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '972' + p.slice(1);
  if (!p.startsWith('972')) p = '972' + p;
  return p;
}
