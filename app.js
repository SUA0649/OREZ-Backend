// backend/app.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const pool = new Pool({
  user: 'orez',
  host: 'localhost',
  database: 'appdb',
  password: 1231231,
  port: 5432,
});

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

// Get files
app.get('/repos/:repoId/files', async (req, res) => {
  const { repoId } = req.params;
  try {
    const { rows: [commit] } = await pool.query(
      `SELECT c.tree_id FROM commits c WHERE c.repo_id = $1 ORDER BY c.timestamp DESC LIMIT 1`,
      [repoId]
    );
    if (!commit) return res.status(404).json({ error: 'No commits' });

    const { rows: files } = await pool.query(
      `SELECT b.path, b.sha, b.size_bytes FROM tree_entries te JOIN blobs b ON te.blob_id = b.id WHERE te.tree_id = $1`,
      [commit.tree_id]
    );

    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get collaborators with permissions
app.get('/repos/:repoId/collaborators', async (req, res) => {
  const { repoId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT u.username, rp.permission_level 
       FROM repository_permissions rp 
       JOIN users u ON rp.user_id = u.id 
       WHERE rp.repo_id = $1`,
      [repoId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.listen(3001, () => {
  console.log('🚀 Backend running on http://localhost:3001');
});