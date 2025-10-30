const { Pool } = require('pg');
const crypto = require('crypto'); // Using it to create hashes.
const fs = require('fs').promises;
const path = require('path');

const pool = new Pool({
  user: 'orez',
  host: 'localhost',
  database: 'appdb',
  password: '1231231',
  port: 5432,
});

async function setup() {
  try {
    const schemaSQL = await fs.readFile('schema.sql', 'utf8')
    await pool.query(schemaSQL);
    console.log('✅ Schema created');

    // User
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (user_name, ) VALUES ($1, $2) ON CONFLICT (user_name) DO NOTHING RETURNING id`,
      ['alice', 'alice@example.com']
    );
    const userId = user?.id || (await pool.query('SELECT id FROM users WHERE user_name = $1', ['alice'])).rows[0].id;

    // Repo
    const { rows: [repo] } = await pool.query(
      `INSERT INTO repositories (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['my-project', userId]
    );

    // Permissions: alice = admin
    await pool.query(
      `INSERT INTO repository_permissions (user_id, repo_id, permission_level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, repo.id, 'admin']
    );

    // File 1: main.js
    const content1 = "console.log('Hello VCS!');";
    const sha1 = crypto.createHash('sha1').update(content1).digest('hex');
    const filePath1 = path.join(__dirname, 'blobs', sha1);
    await fs.mkdir.createWriteFile(filePath1, content1);

    const { rows: [blob1] } = await pool.query(
      `INSERT INTO blobs (sha, path, content_path, repo_id, size_bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [sha1, 'main.js', filePath1, repo.id, content1.length]
    );

    // Tree
    const treeSha = crypto.createHash('sha1').update(`tree-${Date.now()}`).digest('hex');
    const { rows: [tree] } = await pool.query(
      `INSERT INTO trees (sha, repo_id) VALUES ($1, $2) RETURNING id`,
      [treeSha, repo.id]
    );

    // Tree Entry
    await pool.query(
      `INSERT INTO tree_entries (tree_id, blob_id) VALUES ($1, $2)`,
      [tree.id, blob1.id]
    );

    // Commit 1
    const commitSha1 = crypto.createHash('sha1').update(`commit-${Date.now()}`).digest('hex');
    await pool.query(
      `INSERT INTO commits (sha, repo_id, tree_id, author_id, message) VALUES ($1, $2, $3, $4, $5)`,
      [commitSha1, repo.id, tree.id, userId, 'Initial commit']
    );

    console.log('✅ Test data inserted: main.js by alice (admin)');
  } catch (err) {
    console.error('Setup failed:', err);
  } finally {
    await pool.end();
  }
}

setup();