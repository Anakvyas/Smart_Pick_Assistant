const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { newDb } = require('pg-mem');
const app = require('../src/app');
const { signToken } = require('../src/utils/jwt');

const db = newDb();
const pg = db.adapters.createPg();
const pool = new pg.Pool();

require.cache[require.resolve('../src/config/database')].exports.pool = pool;

let migrated = false;

async function ensureSchema() {
  if (migrated) {
    return;
  }

  const migration = `
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'PICKER',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));
  `;

  await pool.query(migration);
  migrated = true;
}

async function resetDatabase() {
  await pool.query('DELETE FROM users');
}

async function seedUser(payload) {
  const passwordHash = await bcrypt.hash(payload.password, 12);
  const result = await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role, is_active, created_at, updated_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NULL)
     RETURNING *`,
    [payload.id, payload.name, payload.email, passwordHash, payload.role || 'PICKER', payload.is_active ?? true],
  );
  return result.rows[0];
}

async function withDb(testFn) {
  await ensureSchema();
  await resetDatabase();
  await testFn();
}


test('Successful signup', async (t) => {
  await withDb(async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Aarav Sharma',
        email: 'Aarav@example.com ',
        password: 'Password@123',
        confirmPassword: 'Password@123',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, 'Picker account created successfully.');
    assert.equal(res.body.data.user.email, 'aarav@example.com');
    assert.equal(res.body.data.user.role, 'PICKER');
    assert.equal(res.headers['set-cookie'][0].includes('picker_session='), true);
    assert.equal(res.body.data.user.password_hash, undefined);
  });
});

test('Duplicate email signup', async () => {
  await withDb(async () => {
    await seedUser({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Existing User',
      email: 'existing@example.com',
      password: 'Password@123',
    });

    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'New User',
        email: 'existing@example.com',
        password: 'Password@123',
        confirmPassword: 'Password@123',
      });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_ALREADY_EXISTS');
  });
});

test('Password mismatch', async () => {
  await withDb(async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
        password: 'Password@123',
        confirmPassword: 'WrongPass@123',
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
});

test('Successful login', async () => {
  await withDb(async () => {
    await seedUser({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Aarav Sharma',
      email: 'aarav@example.com',
      password: 'Password@123',
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'aarav@example.com',
        password: 'Password@123',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, 'aarav@example.com');
    assert.equal(res.headers['set-cookie'][0].includes('picker_session='), true);
  });
});

test('Invalid login', async () => {
  await withDb(async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'unknown@example.com',
        password: 'Password@123',
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });
});

test('/auth/me without authentication', async () => {
  await withDb(async () => {
    const res = await request(app).get('/api/v1/auth/me');

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  });
});

test('/auth/me with valid authentication', async () => {
  await withDb(async () => {
    await seedUser({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Aarav Sharma',
      email: 'aarav@example.com',
      password: 'Password@123',
    });

    const token = signToken({ id: '33333333-3333-4333-8333-333333333333', role: 'PICKER' });
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`picker_session=${token}`]);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, 'aarav@example.com');
  });
});

test('Successful logout', async () => {
  await withDb(async () => {
    const res = await request(app).post('/api/v1/auth/logout');

    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Logged out successfully.');
  });
});

test('Password hash is never returned', async () => {
  await withDb(async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
        password: 'Password@123',
        confirmPassword: 'Password@123',
      });

    assert.equal(JSON.stringify(res.body).includes('password_hash'), false);
    assert.equal(res.body.data.user.password_hash, undefined);
  });
});
