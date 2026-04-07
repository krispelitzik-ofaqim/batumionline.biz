// ===== STATE =====
let adminToken = '';
let userRole = '';
let allClients = [];

const STEP_LABELS = {
  1: 'הרשמה', 2: 'ממתין לאישור דרכון', 3: 'ממתין לאישור',
  4: 'ממתין לתשלום', 5: 'שלב נוטריון', 6: 'שלב נוטריון',
  7: 'צ׳ק ליסט', 8: 'העלאת מסמכים', 9: 'ממתין למשלוח',
  10: 'מסמכים בדרך', 11: 'מסמכים הגיעו', 12: 'חשבון נפתח - משוב', 13: 'הושלם'
};

const STEP_COLORS = {
  1: 'badge-muted', 2: 'badge-orange', 3: 'badge-orange',
  4: 'badge-blue', 5: 'badge-blue', 6: 'badge-blue',
  7: 'badge-blue', 8: 'badge-blue', 9: 'badge-purple',
  10: 'badge-purple', 11: 'badge-green', 12: 'badge-green', 13: 'badge-green'
};

function stepBadge(step) {
  const label = STEP_LABELS[step] || step;
  const color = STEP_COLORS[step] || 'badge-gold';
  return `<span class="badge ${color}">${label}</span>`;
}

function clientName(c) {
  var he = (c.first_name || '') + ' ' + (c.last_name || '');
  var en = ((c.passport_name_en || '') + ' ' + (c.passport_surname_en || '')).trim();
  return en ? he + ' <span style="color:var(--text-muted);font-weight:400;font-size:0.85em;">| ' + en + '</span>' : he;
}

const PASSPORT_LABELS = { pending: 'ממתין', reviewing: 'בבדיקה', approved: '✅ אושר', rejected: '❌ נדחה' };
const PAYMENT_LABELS = { pending: 'ממתין', paid: '✅ שולם' };

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('admin_token');
  const savedRole = sessionStorage.getItem('admin_role');
  if (saved) {
    adminToken = saved;
    userRole = savedRole;
    showPanel();
  }
});

// ===== LOGIN =====
async function doLogin() {
  const pass = document.getElementById('login-pass').value;
  if (!pass) return;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    const data = await res.json();
    if (data.success) {
      adminToken = data.token;
      userRole = data.role;
      sessionStorage.setItem('admin_token', adminToken);
      sessionStorage.setItem('admin_role', userRole);
      showPanel();
    } else {
      document.getElementById('login-error').textContent = 'סיסמה שגויה';
      document.getElementById('login-error').style.display = 'flex';
    }
  } catch (e) {
    document.getElementById('login-error').textContent = 'שגיאת חיבור';
    document.getElementById('login-error').style.display = 'flex';
  }
}

function showPanel() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  document.getElementById('role-badge').textContent = userRole === 'lawyer' ? 'עורך דין' : 'מנהל';

  if (userRole === 'lawyer') {
    document.getElementById('nav-admin-links').style.display = 'none';
    document.getElementById('nav-lawyer-links').style.display = 'block';
    loadLawyerClients();
    showPage('page-lawyer');
  } else {
    loadClients();
    loadDemoState();
  }
}

function logout() {
  sessionStorage.clear();
  window.location.reload();
}

// ===== NAVIGATION =====
function showPage(pageId) {
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById(pageId)?.classList.add('active');
  document.querySelector(`[onclick="showPage('${pageId}')"]`)?.classList.add('active');
}

// ===== API =====
function authHeaders() {
  return { 'Content-Type': 'application/json', 'x-admin-token': adminToken };
}

async function loadClients() {
  try {
    const res = await fetch('/api/admin/clients', { headers: authHeaders() });
    const data = await res.json();
    allClients = data.clients || [];
    renderDashboard();
    renderClientsTable(activeClients());
    renderPendingList();
    renderDocsReviewList();
    renderShippingList();
    renderArchiveList();
    renderTrashList();
    updatePendingCount();
  } catch (e) {
    console.error('Load clients error:', e);
  }
}

async function loadLawyerClients() {
  try {
    const res = await fetch('/api/lawyer/clients', { headers: { 'x-lawyer-token': adminToken } });
    const data = await res.json();
    renderLawyerList(data.clients || []);
  } catch (e) {
    console.error('Load lawyer clients error:', e);
  }
}

// ===== DASHBOARD =====
function activeClients() {
  return allClients.filter(c => !c.archived && !c.trashed);
}

function renderDashboard() {
  const clients = activeClients();
  const total = clients.length;
  const pending = clients.filter(c => c.passport_status === 'reviewing').length;
  const active = clients.filter(c => c.status === 'active' && c.current_step > 2).length;
  const completed = clients.filter(c => c.status === 'completed').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-completed').textContent = completed;

  const tbody = document.getElementById('dashboard-table');
  tbody.innerHTML = clients.slice(0, 10).map(c => `
    <tr class="client-row" onclick="viewClient(${c.id})">
      <td><strong>${clientName(c)}</strong></td>
      <td style="direction:ltr;">${c.phone}</td>
      <td>${stepBadge(c.current_step)}</td>
      <td>${c.preferred_bank || '-'}</td>
      <td>${statusBadge(c.status, c.blocked)}</td>
      <td style="color:var(--text-muted);font-size:0.8rem;">${formatDate(c.created_at)}</td>
    </tr>
  `).join('');
}

function renderClientsTable(clients) {
  const tbody = document.getElementById('clients-table');
  tbody.innerHTML = clients.map(c => `
    <tr class="client-row" onclick="viewClient(${c.id})">
      <td><strong>${clientName(c)}</strong>${c.is_demo ? ' <span class="badge badge-orange" style="font-size:0.65rem;">דמו</span>' : ''}</td>
      <td style="direction:ltr;">${c.phone}</td>
      <td>${stepBadge(c.current_step)}</td>
      <td><span class="badge ${c.passport_status === 'approved' ? 'badge-green' : c.passport_status === 'rejected' ? 'badge-red' : 'badge-blue'}">${PASSPORT_LABELS[c.passport_status] || c.passport_status}</span></td>
      <td><span class="badge ${c.payment_status === 'paid' ? 'badge-green' : 'badge-gold'}">${PAYMENT_LABELS[c.payment_status] || '-'}</span></td>
      <td>${statusBadge(c.status, c.blocked)}</td>
      <td>
        <button class="btn btn-ghost" style="padding:0.3rem 0.75rem;font-size:0.8rem;" onclick="event.stopPropagation();viewClient(${c.id})">פרטים</button>
      </td>
    </tr>
  `).join('');
}

function renderPendingList() {
  const pending = activeClients().filter(c => c.passport_status === 'reviewing');
  const container = document.getElementById('pending-list');

  if (pending.length === 0) {
    container.innerHTML = '<div class="alert alert-info">אין לקוחות הממתינים לאישור כרגע ✅</div>';
    return;
  }

  container.innerHTML = pending.map(c => {
    const docs = ''; // Would load from API
    return `
    <div class="client-detail-panel">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <h3 style="color:var(--text-main);margin-bottom:0.5rem;">${clientName(c)}</h3>
          <div class="detail-row"><span class="detail-label">טלפון:</span><span class="detail-val" style="direction:ltr;">${c.phone}</span></div>
          <div class="detail-row"><span class="detail-label">דרכון:</span><span class="detail-val">${c.passport_number || '-'} (${c.passport_name_en || ''} ${c.passport_surname_en || ''})</span></div>
          <div class="detail-row"><span class="detail-label">תאריך לידה:</span><span class="detail-val">${c.birth_date || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">בנק מועדף:</span><span class="detail-val">${c.preferred_bank || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">דרכון בתוקף:</span><span class="detail-val">${c.passport_valid ? '✅ כן' : '❌ לא'}</span></div>
          <div class="detail-row"><span class="detail-label">נרשם:</span><span class="detail-val">${formatDate(c.created_at)}</span></div>
        </div>
        <div>
          <button class="btn btn-ghost" style="font-size:0.85rem;padding:0.4rem 1rem;" onclick="viewPassport(${c.id})">🔍 צפייה בדרכון</button>
        </div>
      </div>
      <hr class="divider" />
      <div class="action-btns">
        <button class="btn btn-success" onclick="approvePassport(${c.id})">✅ אשר דרכון</button>
        <button class="btn btn-danger" onclick="rejectPassport(${c.id})">❌ דחה דרכון</button>
      </div>
    </div>
  `}).join('');
}

function renderDocsReviewList() {
  // Clients who uploaded docs (step 8-9), waiting for lawyer to review
  const clients = activeClients().filter(c => c.current_step >= 8 && c.current_step <= 9);
  const container = document.getElementById('docs-review-list');
  const countEl = document.getElementById('docs-review-count');
  countEl.textContent = clients.length > 0 ? clients.length : '';

  if (clients.length === 0) {
    container.innerHTML = '<div class="alert alert-info">אין לקוחות הממתינים לבדיקת מסמכים כרגע ✅</div>';
    return;
  }

  container.innerHTML = clients.map(c => `
    <div class="client-detail-panel">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <h3 style="color:var(--text-main);margin-bottom:0.5rem;">${clientName(c)}</h3>
          <div class="detail-row"><span class="detail-label">טלפון:</span><span class="detail-val" style="direction:ltr;">${c.phone}</span></div>
          <div class="detail-row"><span class="detail-label">שלב:</span><span class="detail-val badge badge-gold">${STEP_LABELS[c.current_step] || c.current_step}</span></div>
          <div class="detail-row"><span class="detail-label">בנק:</span><span class="detail-val">${c.preferred_bank || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">נרשם:</span><span class="detail-val">${formatDate(c.created_at)}</span></div>
        </div>
        <div>
          <button class="btn btn-ghost" style="font-size:0.85rem;padding:0.4rem 1rem;" onclick="viewClient(${c.id})">🔍 פרטים ומסמכים</button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderShippingList() {
  // Clients who submitted tracking (step 10) or docs arrived (step 11)
  const clients = activeClients().filter(c => c.current_step >= 10 && c.current_step <= 11);
  const container = document.getElementById('shipping-list');
  const countEl = document.getElementById('shipping-count');
  countEl.textContent = clients.length > 0 ? clients.length : '';

  if (clients.length === 0) {
    container.innerHTML = '<div class="alert alert-info">אין לקוחות בשלב משלוח כרגע ✅</div>';
    return;
  }

  container.innerHTML = clients.map(c => `
    <div class="client-detail-panel">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <h3 style="color:var(--text-main);margin-bottom:0.5rem;">${clientName(c)}</h3>
          <div class="detail-row"><span class="detail-label">טלפון:</span><span class="detail-val" style="direction:ltr;">${c.phone}</span></div>
          <div class="detail-row"><span class="detail-label">חברת משלוח:</span><span class="detail-val">${c.shipping_company || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">מספר מעקב:</span><span class="detail-val" style="direction:ltr;">${c.tracking_number || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">מסמכים הגיעו:</span><span class="detail-val">${c.docs_received ? '✅ כן' : '⏳ בדרך'}</span></div>
        </div>
      </div>
      <div class="action-btns" style="margin-top:1rem;">
        ${c.current_step === 10 ? `<button class="btn btn-success" onclick="adminMarkDocsReceived(${c.id})">📬 מסמכים הגיעו</button>` : ''}
        ${c.current_step === 11 ? `<button class="btn btn-primary" onclick="adminMarkAccountOpened(${c.id})">🎉 החשבון נפתח</button>` : ''}
        <button class="btn btn-ghost" style="font-size:0.85rem;" onclick="viewClient(${c.id})">🔍 פרטים</button>
      </div>
    </div>
  `).join('');
}

function renderLawyerList(clients) {
  const container = document.getElementById('lawyer-list');
  if (clients.length === 0) {
    container.innerHTML = '<div class="alert alert-info">אין לקוחות בשלב זה כרגע</div>';
    return;
  }

  container.innerHTML = clients.map(c => `
    <div class="client-detail-panel">
      <h3 style="color:var(--text-main);margin-bottom:0.75rem;">${clientName(c)}</h3>
      <div class="detail-row"><span class="detail-label">טלפון:</span><span class="detail-val">${c.phone}</span></div>
      <div class="detail-row"><span class="detail-label">מספר משלוח:</span><span class="detail-val" style="direction:ltr;">${c.tracking_number || '-'} (${c.shipping_company || ''})</span></div>
      <div class="detail-row"><span class="detail-label">שלב:</span><span class="detail-val badge badge-gold">${STEP_LABELS[c.current_step] || c.current_step}</span></div>
      <div class="action-btns" style="margin-top:1rem;">
        ${c.current_step === 10 ? `<button class="btn btn-success" onclick="markDocsReceived(${c.id})">📬 מסמכים הגיעו</button>` : ''}
        ${c.current_step === 11 ? `<button class="btn btn-primary" onclick="markAccountOpened(${c.id})">🎉 החשבון נפתח</button>` : ''}
        ${c.docs_received ? '<span class="badge badge-green">✅ מסמכים התקבלו</span>' : ''}
        ${c.account_opened ? '<span class="badge badge-green">🏦 חשבון פתוח</span>' : ''}
      </div>
    </div>
  `).join('');
}

// ===== CLIENT DETAIL =====
async function viewClient(id) {
  try {
    const res = await fetch(`/api/admin/client/${id}`, { headers: authHeaders() });
    const data = await res.json();
    if (!data.success) return;

    const c = data.client;
    const docs = data.docs || [];

    document.getElementById('detail-name').innerHTML = `${clientName(c)} <span style="font-size:0.7em;color:var(--text-muted);font-family:'Assistant',sans-serif;">שלב ${c.current_step}/13</span>`;

    document.getElementById('client-detail-content').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
        <div class="client-detail-panel">
          <h3 style="color:var(--gold-light);margin-bottom:1rem;">פרטים אישיים</h3>
          <div class="detail-row"><span class="detail-label">שם באנגלית:</span><span class="detail-val">${c.passport_name_en || ''} ${c.passport_surname_en || ''}</span></div>
          <div class="detail-row"><span class="detail-label">טלפון:</span><span class="detail-val">${c.phone}</span></div>
          <div class="detail-row"><span class="detail-label">מייל:</span><span class="detail-val">${c.email || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">ת.ז.:</span><span class="detail-val">${c.id_number || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">תאריך לידה:</span><span class="detail-val">${c.birth_date || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">דרכון:</span><span class="detail-val">${c.passport_number || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">בנק:</span><span class="detail-val">${c.preferred_bank || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">נרשם:</span><span class="detail-val">${formatDate(c.created_at)}</span></div>
        </div>
        <div class="client-detail-panel">
          <h3 style="color:var(--gold-light);margin-bottom:1rem;">סטטוס תהליך</h3>
          <div class="detail-row"><span class="detail-label">שלב נוכחי:</span><span class="detail-val">${stepBadge(c.current_step)}</span></div>
          <div class="detail-row"><span class="detail-label">דרכון:</span><span class="detail-val">${PASSPORT_LABELS[c.passport_status] || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">תשלום:</span><span class="detail-val">${PAYMENT_LABELS[c.payment_status] || '-'}</span></div>
          <div class="detail-row"><span class="detail-label">מסמכים:</span><span class="detail-val">${c.docs_received ? '✅ התקבלו' : '⏳ בדרך'}</span></div>
          <div class="detail-row"><span class="detail-label">חשבון:</span><span class="detail-val">${c.account_opened ? '✅ נפתח' : '⏳ ממתין'}</span></div>
          ${c.tracking_number ? `<div class="detail-row"><span class="detail-label">משלוח:</span><span class="detail-val">${c.shipping_company} - ${c.tracking_number}</span></div>` : ''}
          ${c.blocked ? `<div class="detail-row"><span class="detail-label">חסום:</span><span class="detail-val badge badge-red">עד ${formatDate(c.block_until)}</span></div>` : ''}
        </div>
      </div>
      
      <div class="client-detail-panel" style="margin-top:1.5rem;">
        <h3 style="color:var(--gold-light);margin-bottom:1rem;">מסמכים (${docs.length})</h3>
        ${docs.length === 0 ? '<p style="color:var(--text-muted);">אין מסמכים עדיין</p>' : 
          docs.map(d => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:0.5rem;">
              <div>
                <div style="font-weight:600;font-size:0.9rem;">${d.doc_type}</div>
                <div style="font-size:0.8rem;color:var(--text-muted);">${formatDate(d.uploaded_at)}</div>
              </div>
              ${d.drive_url ? `<a href="${d.drive_url}" target="_blank" class="btn btn-ghost" style="padding:0.3rem 0.75rem;font-size:0.8rem;">צפייה 🔗</a>` : ''}
            </div>
          `).join('')}
      </div>

      <div class="client-detail-panel">
        <h3 style="color:var(--gold-light);margin-bottom:1rem;">פעולות</h3>
        <div class="action-btns">
          ${c.passport_status === 'reviewing' ? `
            <button class="btn btn-success" onclick="approvePassport(${c.id})">✅ אשר דרכון</button>
            <button class="btn btn-danger" onclick="rejectPassport(${c.id})">❌ דחה דרכון</button>
          ` : ''}
          ${c.payment_status === 'pending' && c.passport_status === 'approved' ? `
            <button class="btn btn-primary" onclick="confirmPayment(${c.id})">💳 אשר תשלום ידנית</button>
          ` : ''}
          ${c.blocked ? `<button class="btn btn-ghost" onclick="unblockClient(${c.id})">🔓 שחרר חסימה</button>` : ''}
          ${c.archived ? `<button class="btn btn-success" onclick="unarchiveClient(${c.id})">♻️ שחזר מארכיון</button>` : `<button class="btn btn-ghost" onclick="archiveClient(${c.id})">📁 העבר לארכיון</button>`}
          ${c.trashed ? `<button class="btn btn-success" onclick="untrashClient(${c.id})">♻️ שחזר מהפח</button>` : `<button class="btn btn-ghost" style="color:var(--error);" onclick="trashClient(${c.id})">🗑️ העבר לפח</button>`}
          <label class="btn btn-primary" style="cursor:pointer;margin:0;">📄 העלה ייפוי כח לחתימה
            <input type="file" accept=".pdf" style="display:none;" onchange="uploadPoa(${c.id}, this)" />
          </label>
          <a href="/api/admin/client/${c.id}/download-docs?token=${adminToken}" class="btn btn-primary" style="text-decoration:none;">📥 הורד מסמכים</a>
          <a href="/client?phone=${encodeURIComponent(c.phone)}" target="_blank" class="btn btn-ghost">👁 צפה כלקוח</a>
          <button class="btn btn-ghost" style="color:#e67e22;border-color:rgba(230,126,34,0.3);" onclick="showResetPanel(${c.id}, '${(c.first_name||'').replace(/'/g,"\\'")} ${(c.last_name||'').replace(/'/g,"\\'")}')">⚠️ אפס לקוח</button>
        </div>
      </div>

    `;

    showPage('page-client-detail');
  } catch (e) {
    console.error('View client error:', e);
  }
}

// ===== RESET CLIENT (Modal) =====
var resetModalClientId = null;

function showResetPanel(clientId, clientName) {
  resetModalClientId = clientId;
  // Remove existing modal if any
  var old = document.getElementById('reset-modal');
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = 'reset-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeResetModal(); });

  var box = document.createElement('div');
  box.style.cssText = 'background:var(--navy-mid,#1a2a44);border:2px solid #e67e22;border-radius:16px;padding:2rem;width:420px;max-width:90vw;position:relative;';

  box.innerHTML = '<button onclick="closeResetModal()" style="position:absolute;top:0.75rem;left:0.75rem;background:none;border:none;color:rgba(255,255,255,0.4);font-size:1.4rem;cursor:pointer;line-height:1;">✕</button>'
    + '<h3 style="color:#e67e22;margin-bottom:0.75rem;text-align:center;">⚠️ אפס לקוח</h3>'
    + '<p style="color:rgba(255,255,255,0.6);font-size:0.9rem;margin-bottom:1.25rem;text-align:center;">האם אתה בטוח שאתה רוצה לאפס את הלקוח <strong style="color:#e8e0d0;">' + clientName + '</strong> מהרשימה?</p>'
    + '<div id="reset-row1" style="display:flex;gap:0.3rem;justify-content:center;margin-bottom:0.6rem;direction:ltr;"></div>'
    + '<div id="reset-row2" style="display:flex;gap:0.3rem;justify-content:center;margin-bottom:1rem;direction:ltr;"></div>'
    + '<div id="reset-modal-error" class="alert alert-error" style="display:none;margin:0;"></div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  buildResetBoxes(document.getElementById('reset-row1'), 10);
  buildResetBoxes(document.getElementById('reset-row2'), 9);
  document.getElementById('reset-row1').querySelector('input').focus();
}

function closeResetModal() {
  var modal = document.getElementById('reset-modal');
  if (modal) modal.remove();
  resetModalClientId = null;
}

function buildResetBoxes(container, count) {
  for (var i = 0; i < count; i++) {
    var inp = document.createElement('input');
    inp.type = 'password'; inp.maxLength = 1;
    inp.style.cssText = 'width:30px;height:38px;text-align:center;font-size:1rem;font-weight:700;background:rgba(13,27,46,0.8);color:#c9a84c;border:1.5px solid rgba(230,126,34,0.3);border-radius:6px;outline:none;padding:0;font-family:Arial,sans-serif;';
    inp.addEventListener('input', function(e) {
      var b = e.target;
      if (b.value && !/^\d$/.test(b.value)) { b.value = ''; return; }
      if (b.value) { var next = b.nextElementSibling; if (next) next.focus(); }
      checkResetAutoVerify();
    });
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && !e.target.value) {
        var prev = e.target.previousElementSibling;
        if (prev) { prev.focus(); prev.value = ''; }
        e.preventDefault();
      }
      if (e.key === 'Escape') closeResetModal();
    });
    inp.addEventListener('focus', function(e) { e.target.style.borderColor = '#e67e22'; });
    inp.addEventListener('blur', function(e) { e.target.style.borderColor = 'rgba(230,126,34,0.3)'; });
    container.appendChild(inp);
  }
}

function checkResetAutoVerify() {
  var r1 = document.getElementById('reset-row1');
  var r2 = document.getElementById('reset-row2');
  var v1 = Array.from(r1.querySelectorAll('input')).map(function(b) { return b.value; }).join('');
  var v2 = Array.from(r2.querySelectorAll('input')).map(function(b) { return b.value; }).join('');
  if (v1.length === 10 && v2.length === 9) submitResetClient(v1, v2);
}

async function submitResetClient(code1, code2) {
  var errEl = document.getElementById('reset-modal-error');
  errEl.style.display = 'none';
  try {
    var res = await fetch('/api/admin/verified-reset-client', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: resetModalClientId, code1: code1, code2: code2 })
    });
    var data = await res.json();
    if (data.success) {
      closeResetModal();
      alert(data.message || 'הלקוח אופס בהצלחה');
      viewClient(resetModalClientId);
      loadClients();
    } else {
      errEl.textContent = data.error || 'קוד שגוי';
      errEl.style.display = 'flex';
      document.querySelectorAll('#reset-row1 input, #reset-row2 input').forEach(function(b) { b.value = ''; });
      document.getElementById('reset-row1').querySelector('input').focus();
    }
  } catch (e) {
    errEl.textContent = 'שגיאת תקשורת';
    errEl.style.display = 'flex';
  }
}

// ===== ADMIN ACTIONS =====
async function approvePassport(id) {
  if (!confirm('לאשר את הדרכון של הלקוח?')) return;
  try {
    const res = await fetch('/api/admin/passport/approve', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'אושר!');
    loadClients();
    showPage('page-pending');
  } catch (e) { alert('שגיאה'); }
}

async function rejectPassport(id) {
  const reason = prompt('סיבת הדחייה:') || 'הדרכון לא אושר';
  if (reason === null) return;
  try {
    const res = await fetch('/api/admin/passport/reject', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id, reason })
    });
    const data = await res.json();
    alert(data.message || 'נדחה!');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

async function confirmPayment(id) {
  if (!confirm('לאשר את התשלום ידנית?')) return;
  try {
    const res = await fetch('/api/admin/payment/confirm', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'אושר!');
    loadClients();
    viewClient(id);
  } catch (e) { alert('שגיאה'); }
}

async function unblockClient(id) {
  if (!confirm('לשחרר את החסימה?')) return;
  try {
    const res = await fetch('/api/admin/unblock', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'שוחרר!');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

async function markDocsReceived(id) {
  if (!confirm('לסמן שהמסמכים הגיעו?')) return;
  try {
    const res = await fetch('/api/lawyer/docs-received', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lawyer-token': adminToken },
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'עודכן!');
    loadLawyerClients();
  } catch (e) { alert('שגיאה'); }
}

async function markAccountOpened(id) {
  if (!confirm('לסמן שהחשבון נפתח? הלקוח יקבל הודעה מיד!')) return;
  try {
    const res = await fetch('/api/lawyer/account-opened', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lawyer-token': adminToken },
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || '🎉 עודכן!');
    loadLawyerClients();
  } catch (e) { alert('שגיאה'); }
}

function renderArchiveList() {
  const archived = allClients.filter(c => c.archived && !c.trashed);
  const container = document.getElementById('archive-list');
  const countEl = document.getElementById('archive-count');
  countEl.textContent = archived.length > 0 ? archived.length : '';

  if (archived.length === 0) {
    container.innerHTML = '<div class="alert alert-info">אין לקוחות בארכיון ✅</div>';
    return;
  }

  container.innerHTML = archived.map(c => `
    <div class="client-detail-panel">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <h3 style="color:var(--text-main);margin-bottom:0.5rem;">${clientName(c)}</h3>
          <div class="detail-row"><span class="detail-label">טלפון:</span><span class="detail-val" style="direction:ltr;">${c.phone}</span></div>
          <div class="detail-row"><span class="detail-label">שלב אחרון:</span><span class="detail-val">${stepBadge(c.current_step)}</span></div>
          <div class="detail-row"><span class="detail-label">נרשם:</span><span class="detail-val">${formatDate(c.created_at)}</span></div>
        </div>
      </div>
      <div class="action-btns" style="margin-top:1rem;">
        <button class="btn btn-success" onclick="unarchiveClient(${c.id})">♻️ שחזר מארכיון</button>
        <button class="btn btn-ghost" style="font-size:0.85rem;" onclick="viewClient(${c.id})">🔍 פרטים</button>
      </div>
    </div>
  `).join('');
}

async function archiveClient(id) {
  if (!confirm('להעביר לקוח לארכיון?')) return;
  try {
    const res = await fetch('/api/admin/archive', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'הועבר לארכיון');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

async function unarchiveClient(id) {
  if (!confirm('לשחזר לקוח מהארכיון?')) return;
  try {
    const res = await fetch('/api/admin/unarchive', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'שוחזר');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

// ===== TRASH =====
function renderTrashList() {
  const trashed = allClients.filter(c => c.trashed);
  const container = document.getElementById('trash-list');
  const countEl = document.getElementById('trash-count');
  countEl.textContent = trashed.length > 0 ? trashed.length : '';

  if (trashed.length === 0) {
    container.innerHTML = '<div class="alert alert-info">פח הזבל ריק ✅</div>';
    return;
  }

  container.innerHTML = trashed.map(c => `
    <div class="client-detail-panel">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <div>
          <h3 style="color:var(--text-main);margin-bottom:0.5rem;">${clientName(c)}</h3>
          <div class="detail-row"><span class="detail-label">טלפון:</span><span class="detail-val" style="direction:ltr;">${c.phone}</span></div>
          <div class="detail-row"><span class="detail-label">נרשם:</span><span class="detail-val">${formatDate(c.created_at)}</span></div>
          <div class="detail-row"><span class="detail-label">עודכן:</span><span class="detail-val">${formatDate(c.updated_at)}</span></div>
          <div class="detail-row"><span class="detail-label">שלב אחרון:</span><span class="detail-val">${stepBadge(c.current_step)}</span></div>
          <div class="detail-row"><span class="detail-label">סיבה:</span><span class="detail-val">${c.trash_reason || 'ידני'}</span></div>
        </div>
      </div>
      <div class="action-btns" style="margin-top:1rem;">
        <button class="btn btn-success" onclick="untrashClient(${c.id})">♻️ שחזר</button>
        <button class="btn btn-primary" onclick="resetClient(${c.id})">🔄 אפס ואפשר כניסה מחדש</button>
        <button class="btn btn-danger" onclick="deleteClient(${c.id})">🗑️ מחק לצמיתות</button>
        <button class="btn btn-ghost" style="font-size:0.85rem;" onclick="viewClient(${c.id})">🔍 פרטים</button>
      </div>
    </div>
  `).join('');
}

async function trashClient(id) {
  if (!confirm('להעביר לקוח לפח הזבל?')) return;
  try {
    const res = await fetch('/api/admin/trash', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id, reason: 'ידני' })
    });
    const data = await res.json();
    alert(data.message || 'הועבר לפח');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

async function untrashClient(id) {
  if (!confirm('לשחזר לקוח מפח הזבל?')) return;
  try {
    const res = await fetch('/api/admin/untrash', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'שוחזר');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

async function resetClient(id) {
  if (!confirm('לאפס את הלקוח ולאפשר כניסה מחדש? כל ההתקדמות תאופס.')) return;
  try {
    const res = await fetch('/api/admin/reset-client', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'אופס');
    loadClients();
    showPage('page-trash');
  } catch (e) { alert('שגיאה'); }
}

async function deleteClient(id) {
  if (!confirm('למחוק את הלקוח לצמיתות? פעולה זו בלתי הפיכה!')) return;
  if (!confirm('בטוח? הנתונים יימחקו ולא ניתן לשחזר אותם.')) return;
  try {
    const res = await fetch('/api/admin/delete', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'נמחק');
    loadClients();
    showPage('page-trash');
  } catch (e) { alert('שגיאה'); }
}

async function runAutoCleanup() {
  if (!confirm('להריץ ניקוי אוטומטי? לקוחות בשלב 2-3 שלא התקדמו 60+ יום יועברו לפח.')) return;
  try {
    const res = await fetch('/api/admin/cleanup-stale', {
      method: 'POST', headers: authHeaders()
    });
    const data = await res.json();
    alert(data.message || 'הושלם');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

async function adminMarkDocsReceived(id) {
  if (!confirm('לסמן שהמסמכים הגיעו?')) return;
  try {
    const res = await fetch('/api/lawyer/docs-received', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lawyer-token': adminToken },
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || 'עודכן!');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

async function adminMarkAccountOpened(id) {
  if (!confirm('לסמן שהחשבון נפתח? הלקוח יקבל הודעה מיד!')) return;
  try {
    const res = await fetch('/api/lawyer/account-opened', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lawyer-token': adminToken },
      body: JSON.stringify({ client_id: id })
    });
    const data = await res.json();
    alert(data.message || '🎉 עודכן!');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

async function uploadPoa(clientId, input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.type !== 'application/pdf') { alert('רק קבצי PDF מותרים'); return; }

  const formData = new FormData();
  formData.append('poa_file', file);

  try {
    const res = await fetch(`/api/admin/upload-poa/${clientId}`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      const link = data.driveUrl || data.localUrl;
      alert('ייפוי כח הועלה בהצלחה!\n' + (data.driveUrl ? 'קישור: ' + data.driveUrl : ''));
      viewClient(clientId);
    } else {
      alert(data.error || 'שגיאה');
    }
  } catch (e) { alert('שגיאת תקשורת'); }
  input.value = '';
}

async function viewPassport(id) {
  try {
    const res = await fetch(`/api/admin/client/${id}`, { headers: authHeaders() });
    const data = await res.json();
    const passport = data.docs?.find(d => d.doc_type === 'passport');
    if (passport?.drive_url) window.open(passport.drive_url, '_blank');
    else alert('קובץ דרכון לא נמצא');
  } catch (e) { alert('שגיאה'); }
}

// ===== HELPERS =====
function filterClients() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = activeClients().filter(c =>
    `${c.first_name} ${c.last_name} ${c.passport_name_en} ${c.passport_surname_en} ${c.phone} ${c.email}`.toLowerCase().includes(q)
  );
  renderClientsTable(filtered);
}

function updatePendingCount() {
  const count = activeClients().filter(c => c.passport_status === 'reviewing').length;
  const el = document.getElementById('pending-count');
  el.textContent = count > 0 ? count : '';
}

function statusBadge(status, blocked) {
  if (blocked) return '<span class="badge badge-red">חסום</span>';
  const map = { active: 'badge-gold', completed: 'badge-green', blocked: 'badge-red' };
  const labels = { active: 'פעיל', completed: 'הושלם', blocked: 'חסום' };
  return `<span class="badge ${map[status] || 'badge-blue'}">${labels[status] || status}</span>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ===== DEMO =====
var demoModeOn = false;

async function loadDemoState() {
  try {
    var res = await fetch('/api/admin/demo-mode', { headers: authHeaders() });
    var data = await res.json();
    demoModeOn = data.enabled;
    updateDemoBtn();
  } catch (e) {}
}

function updateDemoBtn() {
  var sw = document.getElementById('demo-switch');
  var knob = document.getElementById('demo-knob');
  var label = document.getElementById('demo-label');
  if (!sw) return;
  if (demoModeOn) {
    sw.style.background = '#f39c12';
    knob.style.left = '22px';
    label.textContent = 'ON';
    label.style.color = '#f39c12';
  } else {
    sw.style.background = 'var(--border)';
    knob.style.left = '2px';
    label.textContent = 'OFF';
    label.style.color = 'var(--text-muted)';
  }
}

async function toggleDemoMode() {
  var newState = !demoModeOn;
  try {
    var res = await fetch('/api/admin/demo-mode', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ enabled: newState })
    });
    var data = await res.json();
    demoModeOn = data.enabled;
    updateDemoBtn();
    alert(data.message);
  } catch (e) { alert('שגיאה'); }
}

async function clearDemos() {
  var count = allClients.filter(function(c) { return c.is_demo; }).length;
  if (count === 0) { alert('אין לקוחות דמו למחיקה'); return; }
  if (!confirm('למחוק ' + count + ' לקוחות דמו? מספרי הטלפון שלהם ישוחררו לרישום מחדש.')) return;
  try {
    var res = await fetch('/api/admin/clear-demos', { method: 'POST', headers: authHeaders() });
    var data = await res.json();
    alert(data.message || 'נמחקו');
    loadClients();
  } catch (e) { alert('שגיאה'); }
}

// ===== FEEDBACK =====
function stars(n) {
  n = parseInt(n) || 0;
  return '⭐'.repeat(n) + '☆'.repeat(5 - n);
}

async function loadFeedback() {
  try {
    const res = await fetch('/api/admin/feedback', { headers: authHeaders() });
    const data = await res.json();
    const list = data.feedback || [];

    if (list.length === 0) {
      document.getElementById('feedback-table').innerHTML = '';
      document.getElementById('feedback-empty').style.display = 'flex';
      document.getElementById('feedback-averages').innerHTML = '';
      return;
    }
    document.getElementById('feedback-empty').style.display = 'none';

    // Averages
    var totals = { service: 0, response: 0, accessibility: 0, recommend: 0, count: list.length };
    list.forEach(function(f) {
      totals.service += parseInt(f.service_rating) || 0;
      totals.response += parseInt(f.response_rating) || 0;
      totals.accessibility += parseInt(f.accessibility_rating) || 0;
      totals.recommend += parseInt(f.recommend_rating) || 0;
    });

    document.getElementById('feedback-averages').innerHTML = [
      { label: 'שירות', avg: totals.service / totals.count },
      { label: 'מענה', avg: totals.response / totals.count },
      { label: 'נגישות', avg: totals.accessibility / totals.count },
      { label: 'המלצה', avg: totals.recommend / totals.count }
    ].map(function(item) {
      return '<div class="stat-card" style="text-align:center;">' +
        '<div class="stat-card-num">' + item.avg.toFixed(1) + '</div>' +
        '<div style="font-size:0.85rem;margin:0.25rem 0;">' + stars(Math.round(item.avg)) + '</div>' +
        '<div class="stat-card-label">' + item.label + '</div>' +
      '</div>';
    }).join('');

    // Table
    document.getElementById('feedback-table').innerHTML = list.map(function(f) {
      return '<tr>' +
        '<td><strong>' + (f.client_name || '-') + '</strong></td>' +
        '<td style="direction:ltr;">' + (f.client_phone || '-') + '</td>' +
        '<td style="font-size:0.8rem;color:var(--text-muted);">' + formatDate(f.submitted_at) + '</td>' +
        '<td>' + stars(f.service_rating) + '</td>' +
        '<td>' + stars(f.response_rating) + '</td>' +
        '<td>' + stars(f.accessibility_rating) + '</td>' +
        '<td>' + stars(f.recommend_rating) + '</td>' +
        '<td style="font-size:0.85rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;">' + (f.comment || '-') + '</td>' +
      '</tr>';
    }).join('');
  } catch (e) {
    console.error('Load feedback error:', e);
  }
}

// ===== PASSWORD MANAGEMENT =====
var verifiedSecret = null;

function resetLockout() {
  fetch('/api/admin/reset-lockout', { method: 'POST', headers: authHeaders() }).catch(function(){});
}

async function verifySecret() {
  resetLockout();
  var codes = window._secretCodes || {};
  var c1 = codes.code1 || '';
  var c2 = codes.code2 || '';
  var c3 = codes.code3 || '';
  var errEl = document.getElementById('secret-error');
  errEl.style.display = 'none';

  if (!c1 || !c2 || !c3) return;

  try {
    var res = await fetch('/api/admin/verify-secret', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ code1: c1, code2: c2, code3: c3 })
    });
    var data = await res.json();

    if (data.success) {
      verifiedSecret = { code1: c1, code2: c2, code3: c3 };
      document.getElementById('secret-gate').style.display = 'none';
      document.getElementById('password-panel').style.display = 'block';
      document.getElementById('pw-admin').value = data.admin_password || '';
      document.getElementById('pw-lawyer').value = data.lawyer_password || '';
    } else {
      errEl.textContent = data.error || 'קוד שגוי';
      errEl.style.display = 'flex';
      // Clear all boxes
      document.querySelectorAll('.code-box').forEach(function(b){ b.value=''; });
      var first = document.querySelector('#row1 .code-box');
      if (first) first.focus();
    }
  } catch (e) {
    errEl.textContent = 'שגיאת תקשורת';
    errEl.style.display = 'flex';
  }
}

async function savePasswords() {
  if (!verifiedSecret) return;
  var adminPw = document.getElementById('pw-admin').value.trim();
  var lawyerPw = document.getElementById('pw-lawyer').value.trim();

  if (!adminPw || !lawyerPw) { alert('יש למלא את שתי הסיסמאות'); return; }

  try {
    var res = await fetch('/api/admin/change-passwords', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        code1: verifiedSecret.code1, code2: verifiedSecret.code2, code3: verifiedSecret.code3,
        admin_password: adminPw, lawyer_password: lawyerPw
      })
    });
    var data = await res.json();
    if (data.success) {
      var el = document.getElementById('pw-success');
      el.textContent = 'הסיסמאות עודכנו בהצלחה ✅';
      el.style.display = 'flex';
      // Update current session token if admin password changed
      adminToken = adminPw;
      sessionStorage.setItem('admin_token', adminToken);
    } else {
      alert(data.error || 'שגיאה');
    }
  } catch (e) { alert('שגיאת תקשורת'); }
}
