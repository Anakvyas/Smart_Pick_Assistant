const crypto = require('node:crypto');
const { query } = require('../config/database');

async function findUserByEmail(email) {
  const result = await query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email],
  );

  return result.rows[0] || null;
}

async function createUser({ name, email, passwordHash, role = 'PICKER' }) {
  const id = crypto.randomUUID();
  const result = await query(
    `INSERT INTO users (id, name, email, password_hash, role, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
     RETURNING id, name, email, role`,
    [id, name, email, passwordHash, role],
  );

  return result.rows[0];
}

async function updateLastLogin(userId) {
  await query(
    'UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
    [userId],
  );
}

async function findUserById(id) {
  const result = await query(
    'SELECT id, name, email, role, is_active FROM users WHERE id = $1 LIMIT 1',
    [id],
  );

  return result.rows[0] || null;
}

module.exports = {
  findUserByEmail,
  createUser,
  updateLastLogin,
  findUserById,
};
