// Inscription, connexion, profil  (montées sur /api)
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { authRequired } = require('../middleware/auth');
const { HttpError, handleError } = require('../utils/http');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/register   { name, email, password, depute_id? }
// Le rôle est toujours "voter" : un administrateur se crée directement en base.
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, depute_id } = req.body || {};
    if (!name || !email || !password) throw new HttpError(400, 'Nom, email et mot de passe obligatoires');
    const cleanEmail = String(email).trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) throw new HttpError(400, 'Email invalide');
    if (String(password).length < 8) throw new HttpError(400, 'Mot de passe : 8 caractères minimum');

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length > 0) throw new HttpError(409, 'Email déjà utilisé');

    const hash = await bcrypt.hash(String(password), 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, depute_id) VALUES (?, ?, ?, ?, ?)',
      [String(name).trim(), cleanEmail, hash, 'voter', depute_id || null]
    );
    res.status(201).json({ id: result.insertId, message: 'Compte créé' });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/login   { email, password }  ->  { token, user }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) throw new HttpError(400, 'Email et mot de passe obligatoires');

    const [rows] = await pool.query(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = ?',
      [String(email).trim().toLowerCase()]
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(String(password), user.password_hash));
    if (!ok) throw new HttpError(401, 'Email ou mot de passe incorrect');

    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, process.env.JWT_SECRET, {
      expiresIn: '8h',
    });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/me  ->  profil de l'utilisateur connecté
router.get('/me', authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, email, role, depute_id FROM users WHERE id = ?', [req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'Utilisateur introuvable');
    res.json(rows[0]);
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
