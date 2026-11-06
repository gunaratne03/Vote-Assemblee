// Administration  (montées sur /api/admin — réservé au rôle "admin")
const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../db');
const { getPoll, toSqlDate, nowSql, computeResults } = require('../utils/poll');
const { decryptBallot, loadPrivateKey, shuffle } = require('../utils/crypto');
const { HttpError, handleError, withTransaction, parseId } = require('../utils/http');

const router = express.Router();
const MAX_CHOICES_LIMIT = 30; // limite liée à la taille d'un bulletin chiffré en RSA-2048

async function requirePoll(db, id) {
  const poll = await getPoll(db, id);
  if (!poll) throw new HttpError(404, 'Sondage introuvable');
  return poll;
}

async function countBallots(db, poll) {
  const [[row]] = await db.query(
    poll.is_secret
      ? 'SELECT COUNT(*) AS n FROM secret_participation WHERE poll_id = ?'
      : 'SELECT COUNT(*) AS n FROM votes WHERE poll_id = ?',
    [poll.id]
  );
  return row.n;
}

// POST /api/admin/polls  — crée un sondage + ses paramètres (poll_controls) + ses options
// { title, description?, is_secret, allow_multiple, max_choices, open_at?, close_at?, show_results,
//   options: [{ label, photo_url?, circonscription? }, ...] }
router.post('/polls', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) throw new HttpError(400, 'Titre obligatoire');

    const options = Array.isArray(b.options) ? b.options.filter((o) => o && String(o.label || '').trim()) : [];
    if (options.length < 2) throw new HttpError(400, 'Au moins 2 options sont nécessaires');

    const allowMultiple = b.allow_multiple ? 1 : 0;
    let maxChoices = 1;
    if (allowMultiple) {
      maxChoices = Math.min(Math.max(parseInt(b.max_choices, 10) || 1, 1), MAX_CHOICES_LIMIT, options.length);
    }

    const openAt = toSqlDate(b.open_at);
    const closeAt = toSqlDate(b.close_at);
    if (openAt === undefined || closeAt === undefined) throw new HttpError(400, 'Date invalide');
    if (openAt && closeAt && openAt >= closeAt) {
      throw new HttpError(400, "La fermeture doit être postérieure à l'ouverture");
    }

    const id = await withTransaction(pool, async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO polls (title, description, is_secret, allow_multiple, max_choices, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [title, b.description || null, b.is_secret ? 1 : 0, allowMultiple, maxChoices, req.user.id]
      );
      const pollId = r.insertId;
      await conn.query(
        'INSERT INTO poll_controls (poll_id, is_open, open_at, close_at, show_results) VALUES (?, 0, ?, ?, ?)',
        [pollId, openAt, closeAt, b.show_results ? 1 : 0]
      );
      await conn.query(
        'INSERT INTO options (poll_id, label, photo_url, circonscription, display_order) VALUES ?',
        [options.map((o, i) => [pollId, String(o.label).trim(), o.photo_url || null, o.circonscription || null, i + 1])]
      );
      return pollId;
    });

    res.status(201).json({ id, message: 'Sondage créé (fermé : utilisez « ouvrir » pour le lancer)' });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /api/admin/polls/:id  — uniquement si personne n'a encore voté
router.delete('/polls/:id', async (req, res) => {
  try {
    const poll = await requirePoll(pool, parseId(req.params.id));
    const [[buf]] = await pool.query('SELECT COUNT(*) AS n FROM secret_vote_buffer WHERE poll_id = ?', [poll.id]);
    if ((await countBallots(pool, poll)) > 0 || buf.n > 0 || poll.is_mixed) {
      throw new HttpError(409, 'Suppression impossible : des votes existent déjà');
    }
    await pool.query('DELETE FROM polls WHERE id = ?', [poll.id]); // les options et paramètres suivent (ON DELETE CASCADE)
    res.json({ message: 'Sondage supprimé' });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/admin/polls/:id/options  { label, photo_url?, circonscription? }  — avant le premier vote seulement
router.post('/polls/:id/options', async (req, res) => {
  try {
    const poll = await requirePoll(pool, parseId(req.params.id));
    const label = String((req.body || {}).label || '').trim();
    if (!label) throw new HttpError(400, 'Libellé obligatoire');
    if ((await countBallots(pool, poll)) > 0) throw new HttpError(409, 'Modification impossible : des votes existent déjà');

    const [[m]] = await pool.query('SELECT COALESCE(MAX(display_order), 0) AS m FROM options WHERE poll_id = ?', [poll.id]);
    const [r] = await pool.query(
      'INSERT INTO options (poll_id, label, photo_url, circonscription, display_order) VALUES (?, ?, ?, ?, ?)',
      [poll.id, label, req.body.photo_url || null, req.body.circonscription || null, m.m + 1]
    );
    res.status(201).json({ id: r.insertId, message: 'Option ajoutée' });
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /api/admin/polls/:id/options/:optionId  — avant le premier vote seulement
router.delete('/polls/:id/options/:optionId', async (req, res) => {
  try {
    const poll = await requirePoll(pool, parseId(req.params.id));
    const optionId = parseId(req.params.optionId);
    if ((await countBallots(pool, poll)) > 0) throw new HttpError(409, 'Modification impossible : des votes existent déjà');
    const [r] = await pool.query('DELETE FROM options WHERE id = ? AND poll_id = ?', [optionId, poll.id]);
    if (r.affectedRows === 0) throw new HttpError(404, 'Option introuvable');
    res.json({ message: 'Option supprimée' });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /api/admin/polls/:id/control  { open_at?, close_at?, show_results? }
router.put('/polls/:id/control', async (req, res) => {
  try {
    const poll = await requirePoll(pool, parseId(req.params.id));
    if (poll.is_mixed) throw new HttpError(409, 'Vote déjà dépouillé : paramètres verrouillés');
    const b = req.body || {};
    const openAt = 'open_at' in b ? toSqlDate(b.open_at) : poll.open_at;
    const closeAt = 'close_at' in b ? toSqlDate(b.close_at) : poll.close_at;
    const showResults = 'show_results' in b ? (b.show_results ? 1 : 0) : poll.show_results;
    if (openAt === undefined || closeAt === undefined) throw new HttpError(400, 'Date invalide');
    if (openAt && closeAt && openAt >= closeAt) {
      throw new HttpError(400, "La fermeture doit être postérieure à l'ouverture");
    }
    await pool.query('UPDATE poll_controls SET open_at = ?, close_at = ?, show_results = ? WHERE poll_id = ?', [
      openAt,
      closeAt,
      showResults,
      poll.id,
    ]);
    res.json({ message: 'Paramètres mis à jour', status: (await getPoll(pool, poll.id)).status });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/admin/polls/:id/open  — ouvre le vote (respecte open_at / close_at s'ils existent)
router.post('/polls/:id/open', async (req, res) => {
  try {
    const poll = await requirePoll(pool, parseId(req.params.id));
    if (poll.is_mixed) throw new HttpError(409, 'Vote déjà dépouillé : réouverture impossible');
    await pool.query('UPDATE poll_controls SET is_open = 1 WHERE poll_id = ?', [poll.id]);
    res.json({ message: 'Vote ouvert', status: (await getPoll(pool, poll.id)).status });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/admin/polls/:id/close  — clôture immédiate
router.post('/polls/:id/close', async (req, res) => {
  try {
    const poll = await requirePoll(pool, parseId(req.params.id));
    await pool.query('UPDATE poll_controls SET is_open = 0 WHERE poll_id = ?', [poll.id]);
    res.json({ message: 'Vote clôturé', status: (await getPoll(pool, poll.id)).status });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/admin/polls/:id/participation  — qui a voté (jamais pour qui)
router.get('/polls/:id/participation', async (req, res) => {
  try {
    const poll = await requirePoll(pool, parseId(req.params.id));
    const [[reg]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'voter'");
    const [list] = await pool.query(
      poll.is_secret
        ? `SELECT u.id, u.name, u.email, sp.created_at AS voted_at
           FROM secret_participation sp JOIN users u ON u.id = sp.user_id
           WHERE sp.poll_id = ? ORDER BY sp.created_at`
        : `SELECT u.id, u.name, u.email, MIN(v.created_at) AS voted_at
           FROM votes v JOIN users u ON u.id = v.user_id
           WHERE v.poll_id = ? GROUP BY u.id, u.name, u.email ORDER BY voted_at`,
      [poll.id]
    );
    res.json({ registered_voters: reg.n, participants: list.length, list });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/admin/polls/:id/mix  { private_key? }
// Mixage d'un vote secret : déchiffre le buffer, mélange, écrit dans secret_votes (sans identité), vide le buffer.
// La clé privée peut être fournie dans la requête (commission) ou lue dans keys/private.pem.
router.post('/polls/:id/mix', async (req, res) => {
  try {
    const pollId = parseId(req.params.id);
    const given = req.body && req.body.private_key ? String(req.body.private_key).trim() : '';
    const privatePem = given || loadPrivateKey();

    const summary = await withTransaction(pool, async (conn) => {
      await conn.query('SELECT id FROM polls WHERE id = ? FOR UPDATE', [pollId]);
      const poll = await requirePoll(conn, pollId);
      if (!poll.is_secret) throw new HttpError(400, "Ce sondage n'est pas secret");
      if (poll.status !== 'closed') throw new HttpError(409, 'Clôturez le vote avant le mixage');
      if (poll.is_mixed) throw new HttpError(409, 'Ce vote a déjà été mixé');

      const [buffer] = await conn.query('SELECT id, encrypted_data FROM secret_vote_buffer WHERE poll_id = ?', [pollId]);
      if (buffer.length === 0) throw new HttpError(400, 'Aucun bulletin à mixer');
      const [[part]] = await conn.query('SELECT COUNT(*) AS n FROM secret_participation WHERE poll_id = ?', [pollId]);
      const [opts] = await conn.query('SELECT id FROM options WHERE poll_id = ?', [pollId]);
      const validIds = new Set(opts.map((o) => o.id));

      // 1) Déchiffrement + contrôle de chaque bulletin
      const choices = [];
      for (const row of buffer) {
        let ids;
        try {
          ids = decryptBallot(row.encrypted_data, privatePem);
        } catch (e) {
          throw new HttpError(400, 'Clé privée invalide ou bulletin corrompu');
        }
        if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => validIds.has(id))) {
          throw new HttpError(422, 'Bulletin invalide détecté : mixage annulé');
        }
        choices.push(...ids);
      }

      // 2) Mélange puis écriture anonyme
      const shuffled = shuffle(choices);
      const batchId = randomUUID();
      const fakeDate = poll.close_at || nowSql();
      await conn.query(
        'INSERT INTO secret_votes (poll_id, option_id, mix_order, batch_id, fake_created_at) VALUES ?',
        [shuffled.map((optionId, i) => [pollId, optionId, i + 1, batchId, fakeDate])]
      );

      // 3) Vidage du buffer et verrouillage du sondage
      await conn.query('DELETE FROM secret_vote_buffer WHERE poll_id = ?', [pollId]);
      await conn.query('UPDATE poll_controls SET is_mixed = 1 WHERE poll_id = ?', [pollId]);

      return {
        ballots: buffer.length,
        votes_recorded: shuffled.length,
        participations: part.n,
        integrity_ok: part.n === buffer.length, // autant de bulletins que de participations
        batch_id: batchId,
      };
    });

    res.json({ message: 'Mixage terminé', ...summary });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/admin/polls/:id/export  — résultats au format CSV (ouvrable dans Excel)
router.get('/polls/:id/export', async (req, res) => {
  try {
    const poll = await requirePoll(pool, parseId(req.params.id));
    if (poll.status !== 'closed') throw new HttpError(409, "Le vote n'est pas clôturé");
    if (poll.is_secret && !poll.is_mixed) throw new HttpError(409, "Le mixage n'a pas encore eu lieu");

    const data = await computeResults(pool, poll);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Option', 'Circonscription', 'Voix'].join(';')];
    for (const r of data.results) lines.push([esc(r.label), esc(r.circonscription), r.vote_count].join(';'));
    lines.push('');
    lines.push([esc('Participants'), '', data.participants].join(';'));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="resultats_sondage_${poll.id}.csv"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) {
    handleError(res, err);
  }
});
// ==========================================
// GESTION DES ÉLECTEURS (USERS)
// ==========================================

// 1. Obtenir la liste de tous les utilisateurs
router.get('/users', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, name, email, role, is_validated, created_at FROM users ORDER BY name ASC');
        res.json(users);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' });
    }
});

// 2. Changer le rôle d'un utilisateur
router.put('/users/:id/role', async (req, res) => {
    try {
        const { role } = req.body;
        // On vérifie que le rôle envoyé est valide
        if (!['voter', 'admin'].includes(role)) {
            return res.status(400).json({ error: 'Rôle invalide.' });
        }
        
        await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
        res.json({ message: 'Rôle mis à jour avec succès.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de la mise à jour du rôle.' });
    }
});

// 3. Supprimer un utilisateur
router.delete('/users/:id', async (req, res) => {
    try {
        // Sécurité : on empêche un admin de se supprimer lui-même
        if (parseInt(req.params.id) === req.user.id) {
            return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
        }

        await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ message: 'Utilisateur supprimé avec succès.' });
    } catch (err) {
        console.error(err);
        // Si l'utilisateur a déjà voté, la clé étrangère bloquera la suppression
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ error: 'Impossible de supprimer : cet électeur a déjà participé à un vote.' });
        }
        res.status(500).json({ error: 'Erreur lors de la suppression.' });
    }
});// Valider un compte utilisateur
router.put('/users/:id/validate', async (req, res) => {
    try {
        await pool.query('UPDATE users SET is_validated = TRUE WHERE id = ?', [req.params.id]);
        res.json({ message: 'Compte validé avec succès. L\'électeur peut maintenant voter.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de la validation du compte.' });
    }
});
module.exports = router;
