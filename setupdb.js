// setupdb.js
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const pool = new Pool({
  user: 'orez',
  host: 'localhost',
  database: 'appdb',
  password: '123',
  port: 5432,
});

async function setup() {
  try {
    // 1️⃣ Create schema
    const schemaSQL = await fs.readFile('schema.sql', 'utf8');
    await pool.query(schemaSQL);
    console.log('✅ Schema created');

    // 2️⃣ Insert user
    const passwordHash = crypto.createHash('sha256').update('alicepassword').digest('hex');

    const { rows: [user] } = await pool.query(
      `INSERT INTO users (user_name, password_hash) VALUES ($1, $2)
       ON CONFLICT (user_name) DO NOTHING
       RETURNING user_id`,
      ['alice', passwordHash]
    );

    const userId = user?.user_id || 
      (await pool.query('SELECT user_id FROM users WHERE user_name = $1', ['alice'])).rows[0].user_id;

    // 3️⃣ Insert repository
    const { rows: [repo] } = await pool.query(
      `INSERT INTO repository (name, description, owner_id) VALUES ($1, $2, $3)
       RETURNING repo_id`,
      ['my-project', 'Test project', userId]
    );

    const repoId = repo?.repo_id || 
      (await pool.query('SELECT repo_id FROM repository WHERE name = $1', ['my-project'])).rows[0].repo_id;

    // 4️⃣ Add permissions
    await pool.query(
      `INSERT INTO repopermission (user_id, repo_id, permission) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, repoId, 'Owner']
    );

    // 5️⃣ Create blob (file)
    const content1 = "console.log('Hello VCS!');";
    const sha1 = crypto.createHash('sha1').update(content1).digest('hex');

    // relative path for DB (fits varchar(70))
    const relativePath = path.join('blobs', sha1);

    // make sure directory exists
    await fs.mkdir(path.join(__dirname, 'blobs'), { recursive: true });
    // write file to disk
    await fs.writeFile(path.join(__dirname, relativePath), content1);

    const { rows: [blob1] } = await pool.query(
      `INSERT INTO blob (hash, content_path, size) VALUES ($1, $2, $3)
       RETURNING blob_id`,
      [sha1, relativePath, content1.length]
    );

    const blobId = blob1.blob_id;

    // 6️⃣ Create tree
    const treeSha = crypto.createHash('sha1').update(`tree-${Date.now()}`).digest('hex');

    const { rows: [tree] } = await pool.query(
      `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
      [treeSha, repoId]
    );

    const treeId = tree.tree_id;

    // 7️⃣ Add tree entry linking blob
    await pool.query(
      `INSERT INTO tree_entry (tree_id, blob_id) VALUES ($1, $2)`,
      [treeId, blobId]
    );

    // 8️⃣ Create initial commit
    const commitSha = crypto.createHash('sha1').update(`commit-${Date.now()}`).digest('hex');

    await pool.query(
      `INSERT INTO commit (hash, repo_id, tree_id, owner_id, message) VALUES ($1, $2, $3, $4, $5)`,
      [commitSha, repoId, treeId, userId, 'Initial commit']
    );

    console.log('✅ Test data inserted: main.js by alice (Owner)');
  } catch (err) {
    console.error('Setup failed:', err);
  } finally {
    await pool.end();
  }
}

setup();
