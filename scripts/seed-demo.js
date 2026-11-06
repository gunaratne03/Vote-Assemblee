// Données de démonstration (FICTIVES) : 1 administrateur + 163 comptes "députés" de test
//   npm run seed
require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../db');

(async () => {
  try {
    const adminHash = await bcrypt.hash('Admin12345', 10);
    const voterHash = await bcrypt.hash('Demo12345', 10);

    await pool.query("INSERT IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')", [
      'Administrateur démo',
      'admin@vote.mg',
      adminHash,
    ]);

    const rows = [];
    for (let i = 1; i <= 163; i++) {
      const n = String(i).padStart(3, '0');
      rows.push([`Député démo ${n}`, `depute${n}@assemblee.demo`, voterHash, 'voter', i]);
    }
    const [r] = await pool.query(
      'INSERT IGNORE INTO users (name, email, password_hash, role, depute_id) VALUES ?',
      [rows]
    );

    console.log(`✅ Comptes de démonstration prêts (${r.affectedRows} nouveaux électeurs).`);
    console.log('   Administrateur : admin@vote.mg / Admin12345');
    console.log('   Électeurs      : depute001@assemblee.demo ... depute163@assemblee.demo / Demo12345');
    console.log('⚠️  Comptes fictifs : à supprimer avant toute utilisation réelle.');
  } catch (err) {
    console.error('❌', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
