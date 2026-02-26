/**
 * Run schema-scheduled.sql using DATABASE_URL from .env.
 * Usage: from backend dir: node scripts/run-schema-scheduled.cjs
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to backend/.env');
  process.exit(1);
}

const sqlPath = path.join(__dirname, '..', 'src', 'db', 'schema-scheduled.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({ connectionString: url });

pool
  .query(sql)
  .then(() => {
    console.log('schema-scheduled.sql ran successfully.');
    pool.end();
  })
  .catch((err) => {
    console.error('Error running schema:', err.message);
    pool.end();
    process.exit(1);
  });
