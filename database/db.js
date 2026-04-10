const fs = require('fs');
const path = require('path');
const { DATA_DIR, UPLOADS_DIR } = require('../helpers/storage');

const DB_PATH = path.join(DATA_DIR, 'batumionline.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const uploadsDir = path.join(UPLOADS_DIR, 'passports');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

function backupClient(client) {
  if (!client) return;
  try {
    const phone = (client.phone || 'unknown').replace(/\D/g, '');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${phone}_${ts}.json`;
    const data = load();
    const docs = data.documents.filter(d => d.client_id == client.id);
    const checklist = data.checklist.filter(c => c.client_id == client.id);
    const feedback = data.feedback.filter(f => f.client_id == client.id);
    fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify({ client, docs, checklist, feedback }, null, 2), 'utf8');
    // Keep only last 30 backups
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup_')).sort();
    while (files.length > 30) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (e) { console.warn('Backup error:', e.message); }
}

function load() {
  if (!fs.existsSync(DB_PATH)) return initEmpty();
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch (e) { return initEmpty(); }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function initEmpty() {
  return {
    clients: [], documents: [], checklist: [],
    feedback: [], whatsapp_log: [],
    _seq: { clients: 1, documents: 1, checklist: 1, feedback: 1, whatsapp_log: 1 }
  };
}

function nextId(table) {
  const data = load();
  const id = data._seq[table] || 1;
  data._seq[table] = id + 1;
  save(data);
  return id;
}

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

const clientsDB = {
  create(fields) {
    const id = nextId('clients');
    const client = {
      id, ...fields,
      current_step: 1, status: 'active',
      passport_status: 'pending', payment_status: 'pending',
      payment_ref: null, tracking_number: null, shipping_company: null,
      docs_received: 0, account_opened: 0,
      blocked: 0, block_until: null, block_reason: null,
      created_at: now(), updated_at: now()
    };
    const d = load();
    d.clients.push(client);
    save(d);
    return { lastInsertRowid: id };
  },
  findById(id) { return load().clients.find(c => c.id == id) || null; },
  findByPhone(phone) {
    const norm = (p) => { let n = (p||'').replace(/\D/g,''); if(n.startsWith('972')) return n; if(n.startsWith('0')) return '972'+n.slice(1); return '972'+n; };
    const target = norm(phone);
    return load().clients.find(c => norm(c.phone) === target) || null;
  },
  getAll() { return load().clients; },
  update(id, fields) {
    const data = load();
    const idx = data.clients.findIndex(c => c.id == id);
    if (idx === -1) return;
    data.clients[idx] = { ...data.clients[idx], ...fields, updated_at: now() };
    save(data);
  },
  updateStep(id, step) { this.update(id, { current_step: step }); },
  isBlocked(phone) {
    const c = this.findByPhone(phone);
    if (!c || !c.blocked) return false;
    if (c.block_until && new Date(c.block_until) < new Date()) {
      this.update(c.id, { blocked: 0, block_until: null });
      return false;
    }
    return true;
  },
  block(id, reason, days = 60) {
    const until = new Date();
    until.setDate(until.getDate() + days);
    this.update(id, { blocked: 1, block_reason: reason, block_until: until.toISOString().slice(0, 10), status: 'blocked' });
  },
  delete(id) {
    const data = load();
    data.clients = data.clients.filter(c => c.id != id);
    data.documents = data.documents.filter(d => d.client_id != id);
    data.checklist = data.checklist.filter(c => c.client_id != id);
    data.feedback = data.feedback.filter(f => f.client_id != id);
    data.whatsapp_log = data.whatsapp_log.filter(w => w.client_id != id);
    save(data);
  }
};

const docsDB = {
  add(fields) {
    const data = load();
    const id = nextId('documents');
    data.documents.push({ id, ...fields, uploaded_at: now() });
    save(data);
    return { lastInsertRowid: id };
  },
  getByClient(clientId) { return load().documents.filter(d => d.client_id == clientId); }
};

const checklistDB = {
  upsert(clientId, fields) {
    const data = load();
    const idx = data.checklist.findIndex(c => c.client_id == clientId);
    if (idx === -1) {
      const id = nextId('checklist');
      data.checklist.push({ id, client_id: clientId, ...fields, confirmed_at: now() });
    } else {
      data.checklist[idx] = { ...data.checklist[idx], ...fields, confirmed_at: now() };
    }
    save(data);
  },
  get(clientId) { return load().checklist.find(c => c.client_id == clientId) || null; }
};

const feedbackDB = {
  add(fields) {
    const data = load();
    const id = nextId('feedback');
    data.feedback.push({ id, ...fields, submitted_at: now() });
    save(data);
    return { lastInsertRowid: id };
  },
  getByClient(clientId) { return load().feedback.find(f => f.client_id == clientId) || null; },
  getAll() { return load().feedback; }
};

const whatsappLogDB = {
  add(fields) {
    const data = load();
    const id = nextId('whatsapp_log');
    data.whatsapp_log.push({ id, ...fields, sent_at: now() });
    save(data);
  }
};

const settingsDB = {
  get(key) {
    const data = load();
    if (!data._settings) return null;
    return data._settings[key] !== undefined ? data._settings[key] : null;
  },
  set(key, value) {
    const data = load();
    if (!data._settings) data._settings = {};
    data._settings[key] = value;
    save(data);
  }
};

const db = { pragma: () => {}, exec: () => {} };

module.exports = { db, clientsDB, docsDB, checklistDB, feedbackDB, whatsappLogDB, settingsDB, backupClient };
