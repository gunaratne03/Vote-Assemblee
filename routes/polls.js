// Consultation des sondages et des résultats  (montées sur /api/polls)
const express = require('express');
const pool = require('../db');
const { STATUS_SQL, getPoll, computeResults } = require('../utils/poll');
const { HttpError, handleError, parseId } = require('../utils/http');

const router = express.Router();

// GET /api/polls  ->  liste des sondages (avec "has_voted" pour l'utilisateur connecté)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.title, p.description, p.is_secret, p.allow_multiple, p.max_choices, p.created_at,
              c.open_at, c.close_at, c.show_results, c.is_mixed,
              ${STATUS_SQL} AS status,
              (SELECT COUNT(*) FROM options o WHERE o.poll_id = p.id) AS options_count,
              CASE WHEN p.is_secret = 1
                   THEN EXISTS(SELECT 1 FROM secret_participation sp WHERE sp.poll_id = p.id AND sp.user_id = ?)
                   ELSE EXISTS(SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.user_id = ?)
              END AS has_voted
       FROM polls p JOIN poll_controls c ON c.poll_id = p.id
       ORDER BY p.created_at DESC, p.id DESC`,
      [req.user.id, req.user.id]
    );
    res.json(rows.map((r) => ({ ...r, has_voted: !!r.has_voted })));
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/polls/:id  ->  détail d'un sondage + options
router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const poll = await getPoll(pool, id);
    if (!poll) throw new HttpError(404, 'Sondage introuvable');

    const [options] = await pool.query(
      `SELECT id, label, photo_url, circonscription, display_order, parent_option_id
       FROM options WHERE poll_id = ? ORDER BY display_order, id`,
      [id]
    );
    const [[voted]] = await pool.query(
      poll.is_secret
        ? 'SELECT COUNT(*) AS n FROM secret_participation WHERE poll_id = ? AND user_id = ?'
        : 'SELECT COUNT(*) AS n FROM votes WHERE poll_id = ? AND user_id = ?',
      [id, req.user.id]
    );
    res.json({ ...poll, options, has_voted: voted.n > 0 });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/polls/:id/results
router.get('/:id/results', async (req, res) => {
  try {
    const poll = await getPoll(pool, parseId(req.params.id));
    if (!poll) throw new HttpError(404, 'Sondage introuvable');
    if (poll.status !== 'closed') throw new HttpError(403, 'Résultats disponibles après la clôture du vote');
    if (poll.is_secret && !poll.is_mixed) {
      throw new HttpError(403, 'Résultats disponibles après le mixage des votes secrets');
    }
    if (!poll.show_results && req.user.role !== 'admin') {
      throw new HttpError(403, "Les résultats ne sont pas publics pour l'instant");
    }
    res.json(await computeResults(pool, poll));
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
