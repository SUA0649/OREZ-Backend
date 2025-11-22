// setupdb.js
const { Pool } = require('pg');
const crypto = require('crypto');
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
    // 1️⃣ Create schema
    const schemaSQL = await fs.readFile('schema.sql', 'utf8');
    await pool.query(schemaSQL);
    console.log('✅ Schema created');

    // // 2️⃣ Insert user
    // const passwordHash = crypto.createHash('sha256').update('alicepassword').digest('hex');

    // const { rows: [user] } = await pool.query(
    //   `INSERT INTO users (user_name, password_hash) VALUES ($1, $2)
    //    ON CONFLICT (user_name) DO NOTHING
    //    RETURNING user_id`,
    //   ['alice', passwordHash]
    // );

    // const userId = user?.user_id || 
    //   (await pool.query('SELECT user_id FROM users WHERE user_name = $1', ['alice'])).rows[0].user_id;

    // // 3️⃣ Insert repository
    // const { rows: [repo] } = await pool.query(
    //   `INSERT INTO repository (name, description, owner_id) VALUES ($1, $2, $3)
    //    ON CONFLICT (name) DO NOTHING -- Assuming name is unique or should be, added this for idempotency
    //    RETURNING repo_id`,
    //   ['MyFirstRepo', 'An initial repository for testing', userId]
    // );

    // const repoId = repo?.repo_id || 
    //   (await pool.query('SELECT repo_id FROM repository WHERE name = $1', ['MyFirstRepo'])).rows[0].repo_id;

    // // 4️⃣ Add initial permissions (Owner for the creator)
    // await pool.query(
    //   `INSERT INTO RepoPermission (user_id, repo_id, permission) VALUES ($1, $2, $3)
    //    ON CONFLICT (user_id, repo_id) DO NOTHING`, // FIX: Prevents duplicate insert errors
    //   [userId, repoId, 'Owner']
    // );

    // console.log(`✅ User ${userId} and Repo ${repoId} created with Owner permission`);

    // // 5️⃣ Create a blob file
    // const content1 = 'console.log("Hello, Git Lite!");\n';
    // const sha1 = crypto.createHash('sha1').update(content1).digest('hex');
    // const relativePath = path.join('blobs', sha1);

    // // make sure directory exists
    // await fs.mkdir(path.join(__dirname, 'blobs'), { recursive: true });
    // // write file to disk
    // await fs.writeFile(path.join(__dirname, relativePath), content1);

    // const { rows: [blob1] } = await pool.query(
    //   `INSERT INTO blob (hash, content_path, size) VALUES ($1, $2, $3)
    //    RETURNING blob_id`,
    //   [sha1, relativePath, content1.length]
    // );

    // const blobId = blob1.blob_id;

    // // 6️⃣ Create tree
    // const treeSha = crypto.createHash('sha1').update(`tree-${Date.now()}`).digest('hex');

    // const { rows: [tree] } = await pool.query(
    //   `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
    //   [treeSha, repoId]
    // );

    // const treeId = tree.tree_id;

    // // 7️⃣ Add tree entry linking blob
    // await pool.query(
    //   `INSERT INTO tree_entry (tree_id, blob_id, name, mode) VALUES ($1, $2, $3, $4)
    //    ON CONFLICT (tree_id, name) DO NOTHING`, // Added for idempotency
    //   [treeId, blobId, 'main.js', '100644']
    // );

    // // 8️⃣ Create initial commit
    // const commitSha = crypto.createHash('sha1').update(`commit-${Date.now()}`).digest('hex');

    // await pool.query(
    //   `INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message) VALUES ($1, $2, $3, $4, $5)
    //    ON CONFLICT (hash) DO NOTHING`, // Added for idempotency
    //   [commitSha, repoId, treeId, userId, 'Initial commit']
    // );

    // console.log('✅ Initial commit added');

  } catch (error) {
    console.error('Setup failed:', error);
  } finally {
    await pool.end();
  }
}

setup();