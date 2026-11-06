// Outils communs : erreurs HTTP, transactions SQL, validation d'identifiant

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function handleError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: 'Erreur serveur' });
}

// Exécute fn(conn) dans une transaction : COMMIT si tout va bien, ROLLBACK sinon
async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function parseId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identifiant invalide');
  return n;
}

module.exports = { HttpError, handleError, withTransaction, parseId };
