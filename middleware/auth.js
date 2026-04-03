function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.cookies?.admin_token;
  if (token === process.env.ADMIN_PASSWORD) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function lawyerAuth(req, res, next) {
  const token = req.headers['x-lawyer-token'] || req.cookies?.lawyer_token;
  if (token === process.env.LAWYER_PASSWORD || token === process.env.ADMIN_PASSWORD) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function clientAuth(req, res, next) {
  const phone = req.headers['x-client-phone'] || req.body?.phone;
  if (!phone) return res.status(401).json({ error: 'Phone required' });
  req.clientPhone = phone;
  next();
}

module.exports = { adminAuth, lawyerAuth, clientAuth };
