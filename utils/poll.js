// Fonctions partagées sur les sondages

// Statut calculé par la base : 'open' | 'scheduled' | 'closed'
// (alias SQL attendu : c = poll_controls)
const STATUS_SQL = `CASE
  WHEN c.is_open = 1 AND (c.open_at IS NULL OR c.open_at <= NOW())
       AND (c.close_at IS NULL OR c.close_at >= NOW()) THEN 'open'
  WHEN c.is_open = 1 AND c.open_at IS NOT NULL AND c.open_at > NOW() THEN 'scheduled'
  ELSE 'closed'
END`;

async function getPoll(db, id) {
  const [rows] = await db.query(
    `SELECT p.id, p.title, p.description, p.is_secret, p.allow_multiple, p.max_choices,
            p.created_by, p.created_at,
            c.is_open, c.open_at, c.close_at, c.show_results, c.is_mixed,
            ${STATUS_SQL} AS status
     FROM polls p JOIN poll_controls c ON c.poll_id = p.id
     WHERE p.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// Vérifie la liste de choix d'un électeur. Retourne { error, ids }
async function validateChoices(db, poll, optionIds) {
  if (!Array.isArray(optionIds) || optionIds.length === 0) return { error: 'Aucun choix sélectionné' };
  const ids = optionIds.map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return { error: 'Choix invalide' };
  if (new Set(ids).size !== ids.length) return { error: 'Choix en double' };
  const limit = poll.allow_multiple ? poll.max_choices : 1;
  if (ids.length > limit) return { error: `Maximum ${limit} choix autorisé(s)` };
  const [rows] = await db.query('SELECT id FROM options WHERE poll_id = ? AND id IN (?)', [poll.id, ids]);
  if (rows.length !== ids.length) return { error: "Un des choix n'appartient pas à ce sondage" };
  return { ids };
}

// Convertit "2026-11-03T09:00" en "2026-11-03 09:00:00". null si vide, undefined si invalide.
function toSqlDate(value) {
  if (value === undefined || value === null || value === '') return null;
  let s = String(value).trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) return undefined;
  return s.slice(0, 19);
}

function nowSql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Résultats : calculés uniquement sur "votes" (ordinaire) ou "secret_votes" (secret, sans lien avec les utilisateurs)
async function computeResults(db, poll) {
  const table = poll.is_secret ? 'secret_votes' : 'votes'; // valeur fixe, jamais issue de l'utilisateur
  const [results] = await db.query(
    `SELECT o.id, o.label, o.photo_url, o.circonscription, COUNT(t.id) AS vote_count
     FROM options o
     LEFT JOIN ${table} t ON t.option_id = o.id AND t.poll_id = o.poll_id
     WHERE o.poll_id = ?
     GROUP BY o.id, o.label, o.photo_url, o.circonscription
     ORDER BY vote_count DESC, o.display_order, o.id`,
    [poll.id]
  );
  const [[part]] = await db.query(
    poll.is_secret
      ? 'SELECT COUNT(*) AS n FROM secret_participation WHERE poll_id = ?'
      : 'SELECT COUNT(DISTINCT user_id) AS n FROM votes WHERE poll_id = ?',
    [poll.id]
  );
  return { poll: { id: poll.id, title: poll.title, is_secret: poll.is_secret }, participants: part.n, results };
}

module.exports = { STATUS_SQL, getPoll, validateChoices, computeResults, toSqlDate, nowSql };
