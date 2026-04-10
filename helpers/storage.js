const path = require('path');

// On Render, set PERSIST_DIR=/data (mounted disk). Locally falls back to repo root.
const ROOT = process.env.PERSIST_DIR || path.join(__dirname, '..');

module.exports = {
  PERSIST_ROOT: ROOT,
  DATA_DIR: path.join(ROOT, 'data'),
  UPLOADS_DIR: path.join(ROOT, 'uploads'),
};
