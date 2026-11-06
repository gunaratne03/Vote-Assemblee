// Connexion à MariaDB (pool mysql2 en mode "promesses")
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'vote_db',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // les dates restent des chaînes "AAAA-MM-JJ HH:MM:SS" (pas de décalage de fuseau)
});

module.exports = pool;
