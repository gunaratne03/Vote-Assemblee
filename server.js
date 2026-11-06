require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET manquant : ajoutez-le dans le fichier .env');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // AJOUT 1 : Module pour gérer les dossiers
const multer = require('multer'); // AJOUT 2 : Module pour les uploads
const pool = require('./db');
const { authRequired, adminRequired } = require('./middleware/auth');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // interface web (dossier public/)

// ==========================================
// AJOUT 3 : CONFIGURATION DES UPLOADS D'IMAGES
// ==========================================
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir); // Crée le dossier 'uploads' s'il n'existe pas
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Rend le dossier 'uploads' accessible publiquement pour afficher les photos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// ==========================================

// Vérifie que le serveur et la base répondent
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', database: 'injoignable' });
  }
});

// ==========================================
// AJOUT 4 : LA ROUTE POUR RECEVOIR L'IMAGE
// ==========================================
// Protégée pour que seul un admin connecté puisse uploader une photo
app.post('/api/admin/upload', authRequired, adminRequired, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier fourni.' });
    }
    // On renvoie l'URL de l'image qui sera stockée dans la base de données
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ message: 'Image uploadée avec succès', imageUrl: imageUrl });
});
// ==========================================

app.use('/api', require('./routes/auth')); // /register, /login, /me
app.use('/api/polls', authRequired, require('./routes/polls')); // consultation des sondages et résultats
app.use('/api/polls', authRequired, require('./routes/votes')); // vote ordinaire et vote secret
app.use('/api/admin', authRequired, adminRequired, require('./routes/admin')); // administration

app.use('/api', (req, res) => res.status(404).json({ error: 'Route introuvable' }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur démarré : http://localhost:${PORT}`));