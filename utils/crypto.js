// Chiffrement des bulletins secrets : RSA-OAEP (SHA-256), 2048 bits
//  - la clé PUBLIQUE chiffre le bulletin au moment du vote
//  - la clé PRIVÉE ne sert qu'au mixage, après la clôture
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { HttpError } = require('./http');

const KEYS_DIR = path.join(__dirname, '..', 'keys');
const PADDING = crypto.constants.RSA_PKCS1_OAEP_PADDING;

function readKey(name) {
  try {
    return fs.readFileSync(path.join(KEYS_DIR, name), 'utf8');
  } catch (err) {
    throw new HttpError(500, 'Clés de chiffrement introuvables : exécutez « npm run keys »');
  }
}

const loadPublicKey = () => readKey('public.pem');
const loadPrivateKey = () => readKey('private.pem');

// optionIds : tableau d'identifiants, ex. [12] ou [3, 8]  ->  texte base64
function encryptBallot(optionIds) {
  const data = Buffer.from(JSON.stringify(optionIds), 'utf8');
  return crypto
    .publicEncrypt({ key: loadPublicKey(), padding: PADDING, oaepHash: 'sha256' }, data)
    .toString('base64');
}

function decryptBallot(encrypted, privatePem) {
  const plain = crypto.privateDecrypt(
    { key: privatePem, padding: PADDING, oaepHash: 'sha256' },
    Buffer.from(encrypted, 'base64')
  );
  return JSON.parse(plain.toString('utf8'));
}

// Mélange de Fisher-Yates avec un générateur cryptographique
function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { encryptBallot, decryptBallot, loadPrivateKey, shuffle };
