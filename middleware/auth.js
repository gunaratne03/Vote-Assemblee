const jwt = require('jsonwebtoken');

// Vérifie le jeton JWT envoyé dans l'en-tête  Authorization: Bearer <token>
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { id, role, name }
    next();
  } catch (err) {
    res.status(401).json({ error: 'Jeton invalide ou expiré' });
  }
}

// Réserve une route aux administrateurs
function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}

module.exports = { authRequired, adminRequired };
