# Vote-Assemblee — backend complet (étape 1)

## Où placer les fichiers
Dézippez, puis **copiez tout le contenu** de `Vote-Assemblee-ajouts/` dans votre dossier `Vote-Assemblee/`
(remplacez `db.js` et `server.js` quand Windows le demande).

```
Vote-Assemblee/
├── .env                  ← à compléter (voir étape 2)
├── .gitignore
├── package.json          ← ajouter les "scripts" (étape 3)
├── db.js                 ← pool MariaDB
├── server.js             ← point d'entrée Express
├── middleware/auth.js    ← JWT : authRequired, adminRequired
├── utils/
│   ├── http.js           ← erreurs, transactions SQL
│   ├── poll.js           ← statut d'un vote, validation des choix, résultats
│   └── crypto.js         ← chiffrement RSA des bulletins secrets, mélange
├── routes/
│   ├── auth.js           ← /api/register, /api/login, /api/me
│   ├── polls.js          ← consultation des sondages et résultats
│   ├── votes.js          ← vote ordinaire et vote secret
│   └── admin.js          ← création, ouverture/clôture, mixage, export
├── scripts/
│   ├── generate-keys.js  ← crée la paire de clés RSA (dossier keys/)
│   ├── seed-demo.js      ← administrateur + 163 députés FICTIFS
│   └── simulate-election.js ← test de bout en bout
└── public/               ← interface web (étape suivante)
```

## Installation (une seule fois)
1. **Base de données** : importez `schema_vote_db.sql` dans phpMyAdmin (base `vote_db`, onglet *Importer*).
2. **`.env`** : gardez vos lignes `DB_*` et ajoutez `PORT=3000` et `JWT_SECRET=...`
   (valeur aléatoire : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
3. **`package.json`** : dans la section `"scripts"`, mettez :
   ```json
   "scripts": {
     "start": "node server.js",
     "dev": "node --watch server.js",
     "keys": "node scripts/generate-keys.js",
     "seed": "node scripts/seed-demo.js",
     "simulate": "node scripts/simulate-election.js"
   }
   ```
4. Dans le terminal VS Code (dossier `Vote-Assemblee`) :
   ```
   npm run keys
   npm run seed
   npm start
   ```
5. Ouvrez http://localhost:3000/api/health : vous devez voir `{"status":"ok","database":"ok"}`.
6. Second terminal : `npm run simulate`. Le script fait voter les 163 députés et vérifie tout.

## Routes de l'API
| Méthode | Route | Rôle |
|---|---|---|
| POST | /api/register, /api/login | inscription, connexion (JWT 8 h) |
| GET | /api/me | profil connecté |
| GET | /api/polls, /api/polls/:id | liste, détail + options |
| POST | /api/polls/:id/vote | vote ordinaire `{ "option_ids": [3] }` |
| POST | /api/polls/:id/secret-vote | vote secret `{ "option_ids": [3] }` |
| GET | /api/polls/:id/results | résultats (après clôture, et mixage si secret) |
| POST | /api/admin/polls | créer un sondage + options + paramètres |
| POST | /api/admin/polls/:id/open, /close | ouvrir, clôturer |
| PUT | /api/admin/polls/:id/control | dates, affichage des résultats |
| POST/DELETE | /api/admin/polls/:id/options | ajouter, retirer une option (avant le 1er vote) |
| GET | /api/admin/polls/:id/participation | qui a voté (jamais pour qui) |
| POST | /api/admin/polls/:id/mix | mixage du vote secret |
| GET | /api/admin/polls/:id/export | résultats en CSV |
| DELETE | /api/admin/polls/:id | suppression (avant le 1er vote) |

## Créer un vrai administrateur
Inscrivez-vous via `/api/register`, puis dans phpMyAdmin (onglet SQL) :
`UPDATE users SET role='admin' WHERE email='votre@email';`

## À ne jamais publier
`.env` et le dossier `keys/` (déjà exclus par `.gitignore`). Les comptes de `npm run seed` sont fictifs.
