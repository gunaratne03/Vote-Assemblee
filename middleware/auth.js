const jwt = require('jsonwebtoken');
const pool = require('../db'); // 1. Ajout de l'importation de la base de données

// Vérifie le jeton JWT envoyé dans l'en-tête Authorization: Bearer <token>
async function authRequired(req, res, next) { // 2. Ajout de "async"
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentification requise' });
  
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { id, role, name }
    
    // 3. Vérification dans la base de données
    const [rows] = await pool.query('SELECT is_validated FROM users WHERE id = ?', [req.user.id]);
    
    if (rows.length === 0) {
        return res.status(401).json({ error: 'Utilisateur introuvable.' });
    }

    // Si ce n'est pas un admin ET que le compte n'est pas validé -> on bloque
    if (req.user.role !== 'admin' && !rows[0].is_validated) {
        return res.status(403).json({ error: 'Votre compte est en attente de validation par l\'administration.' });
    }

    next();
  } catch (err) {
    console.error(err); // Utile pour voir les erreurs dans le terminal
    res.status(401).json({ error: 'Jeton invalide ou expiré' });
  }
}

// Réserve une route aux administrateurs (inchangé)
function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}

module.exports = { authRequired, adminRequired };