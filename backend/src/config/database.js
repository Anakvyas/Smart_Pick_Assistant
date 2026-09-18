const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
});

const database = {
  pool,
  async query(text, params = []) {
    return database.pool.query(text, params);
  },
};

module.exports = database;
