// ===== STATE =====
let adminToken = '';
let userRole = '';
let allClients = [];

const STEP_LABELS = {
  1: 'רישום', 2: 'ממתין לאישור דרכון', 3: 'ממתין לאישור',
  4: 'תשלום', 5: 'נוטוריון', 6: 'נוטוריון',
  7: 'צ\'ק ליסט', 8: 'העלאת מסמכים', 9: 'שליחה',
  10: 'ממתין למשלוח', 11: 'עו"ד מטפל', 12: 'משוב', 13: 'הושלם'
};

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
    renderClientsTable(allClients);
    renderPendingList();
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
function renderDashboard() {
  const total = allClients.length;
  const pending = allClients.filter(c => c.passport_status === 'reviewing').length;
  const active = allClients.filter(c => c.status === 'active' && c.current_step > 2).length;
  const completed = allClients.filter(c => c.status === 'completed').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-completed').textContent = completed;

  const tbody = document.getElementById('dashboard-table');
  tbody.innerHTML = allClients.slice(0, 10).map(c => `
    <tr class="client-row" onclick="viewClient(${c.id})">
      <td><strong>${c.first_name || ''} ${c.last_name || ''}</strong></td>
      <td style="direction:ltr;">${c.phone}</td>
      <td><span class="badge badge-gold">${STEP_LABELS[c.current_step] || c.current_step}</span></td>
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
      <td><strong>${c.first_name || ''} ${c.last_name || ''}</strong></td>
      <td style="direction:ltr;">${c.phone}</td>
      <td><span class="badge badge-gold">${STEP_LABELS[c.current_step] || c.current_step}</span></td>
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
  const pending = allClients.filter(c => c.passport_status === 'reviewing');
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
          <h3 style="color:var(--text-main);margin-bottom:0.5rem;">${c.first_name || ''} ${c.last_name || ''}</h3>
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

function renderLawyerList(clients) {
  const container = document.getElementById('lawyer-list');
  if (clients.length === 0) {
    container.innerHTML = '<div class="alert alert-info">אין לקוחות בשלב זה כרגע</div>';
    return;
  }

  container.innerHTML = clients.map(c => `
    <div class="client-detail-panel">
      <h3 style="color:var(--text-main);margin-bottom:0.75rem;">${c.first_name || ''} ${c.last_name || ''}</h3>
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

    document.getElementById('detail-name').textContent = `${c.first_name || ''} ${c.last_name || ''}`;

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
          <div class="detail-row"><span class="detail-label">שלב נוכחי:</span><span class="detail-val badge badge-gold">${STEP_LABELS[c.current_step] || c.current_step}</span></div>
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
          <a href="/client?phone=${encodeURIComponent(c.phone)}" target="_blank" class="btn btn-ghost">👁 צפה כלקוח</a>
        </div>
      </div>
    `;

    showPage('page-client-detail');
  } catch (e) {
    console.error('View client error:', e);
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
  const filtered = allClients.filter(c =>
    `${c.first_name} ${c.last_name} ${c.phone} ${c.email}`.toLowerCase().includes(q)
  );
  renderClientsTable(filtered);
}

function updatePendingCount() {
  const count = allClients.filter(c => c.passport_status === 'reviewing').length;
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
