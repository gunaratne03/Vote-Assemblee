// Génère la paire de clés RSA du vote secret dans le dossier keys/
//   node scripts/generate-keys.js            (ou : npm run keys)
//   node scripts/generate-keys.js --force    (régénère : les bulletins déjà en attente deviendraient illisibles)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'keys');
const privateFile = path.join(dir, 'private.pem');

if (fs.existsSync(privateFile) && !process.argv.includes('--force')) {
  console.log('Les clés existent déjà (keys/). Utilisez --force pour les régénérer.');
  process.exit(0);
}

fs.mkdirSync(dir, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
fs.writeFileSync(path.join(dir, 'public.pem'), publicKey);
fs.writeFileSync(privateFile, privateKey, { mode: 0o600 });
console.log('✅ Clés générées dans keys/ (public.pem : chiffrement, private.pem : mixage).');
console.log('⚠️  Ne publiez jamais le dossier keys/ (déjà exclu par .gitignore).');
