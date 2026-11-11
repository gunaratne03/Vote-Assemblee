// Vote ordinaire et vote secret  (montées sur /api/polls)
const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../db');
const { getPoll, validateChoices } = require('../utils/poll');
const { encryptBallot } = require('../utils/crypto');
const { HttpError, handleError, withTransaction, parseId } = require('../utils/http');

const router = express.Router();

// POST /api/polls/:id/vote   { option_ids: [3] }
// Vote ordinaire : enregistré dans "votes", lié à l'utilisateur.
router.post('/:id/vote', async (req, res) => {
  try {
    const pollId = parseId(req.params.id);
    const { option_ids } = req.body || {};

    await withTransaction(pool, async (conn) => {
      // Verrou sur la ligne de l'utilisateur : deux clics simultanés ne peuvent pas passer ensemble
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);

      const poll = await getPoll(conn, pollId);
      if (!poll) throw new HttpError(404, 'Sondage introuvable');
      if (poll.is_secret) throw new HttpError(400, 'Ce sondage est secret : utilisez le vote secret');
      if (poll.status !== 'open') throw new HttpError(409, "Ce vote n'est pas ouvert");

      // --- NOUVEAU : VÉRIFICATION STRICTE DES DATES ---
      const now = new Date();
      if (poll.close_at && new Date(poll.close_at) < now) {
          throw new HttpError(403, "Le vote est fermé : la date limite est dépassée.");
      }
      // ------------------------------------------------

      const { error, ids } = await validateChoices(conn, poll, option_ids);
      if (error) throw new HttpError(400, error);

      const [[already]] = await conn.query('SELECT COUNT(*) AS n FROM votes WHERE user_id = ? AND poll_id = ?', [
        req.user.id,
        pollId,
      ]);
      if (already.n > 0) throw new HttpError(409, 'Vous avez déjà voté');

      await conn.query('INSERT INTO votes (user_id, poll_id, option_id) VALUES ?', [
        ids.map((optionId) => [req.user.id, pollId, optionId]),
      ]);
    });

    res.status(201).json({ message: 'Vote enregistré' });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/polls/:id/secret-vote   { option_ids: [3] }
// Vote secret : 1) participation enregistrée (qui a voté)  2) bulletin chiffré déposé dans le buffer (sans identité)
router.post('/:id/secret-vote', async (req, res) => {
  try {
    const pollId = parseId(req.params.id);
    const { option_ids } = req.body || {};

    await withTransaction(pool, async (conn) => {
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);

      const poll = await getPoll(conn, pollId);
      if (!poll) throw new HttpError(404, 'Sondage introuvable');
      if (!poll.is_secret) throw new HttpError(400, "Ce sondage n'est pas secret : utilisez le vote ordinaire");
      if (poll.status !== 'open') throw new HttpError(409, "Ce vote n'est pas ouvert");
      if (poll.is_mixed) throw new HttpError(409, 'Ce vote est déjà dépouillé');

      // --- NOUVEAU : VÉRIFICATION STRICTE DES DATES ---
      const now = new Date();
      if (poll.close_at && new Date(poll.close_at) < now) {
          throw new HttpError(403, "Le vote est fermé : la date limite est dépassée.");
      }
      // ------------------------------------------------

      const { error, ids } = await validateChoices(conn, poll, option_ids);
      if (error) throw new HttpError(400, error);

      const [[already]] = await conn.query(
        'SELECT COUNT(*) AS n FROM secret_participation WHERE user_id = ? AND poll_id = ?',
        [req.user.id, pollId]
      );
      if (already.n > 0) throw new HttpError(409, 'Vous avez déjà voté');

      await conn.query('INSERT INTO secret_participation (user_id, poll_id) VALUES (?, ?)', [req.user.id, pollId]);
      // Identifiant aléatoire et aucune date : impossible de rapprocher ce bulletin de la participation
      await conn.query('INSERT INTO secret_vote_buffer (id, poll_id, encrypted_data) VALUES (?, ?, ?)', [
        randomUUID(),
        pollId,
        encryptBallot(ids),
      ]);
    });

    res.status(201).json({ message: 'Vote secret enregistré' });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;