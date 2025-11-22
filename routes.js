// ---- Getting libraries ----
const express = require('express');
const { Pool } = require('pg');
// Pool used for multiple queries with repeatidly opening / closing connections
const crypto = require('crypto'); // For hashing 
const router = express.Router(); // Creating router instance
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver'); 
// ----------------------------

// ---- Multer (memory) setup ----
const storage = multer.memoryStorage();
const upload = multer({ storage });
// --------------------------------


// ---- Setting up database connection pool ----
// Every subquery will use the below configuratoion to connect to the database
const pool = new Pool({
  user: 'orez',
  host: 'localhost',
  database: 'appdb',
  password: '123',
  port: 5432,
});
// ----------------------------------------------

// This just makes that /signup endpoint will make a post request, req and res means request and response
router.post('/signup', async(req, res) =>{
    //This is the json body that we get from the requst (frontend)
    //Make sure when you parse it the variables are the same as what you send from frontend in .json
    const { user_name, password } = req.body;
    //Just hashing the password
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    //now insert
    try {
        const { rows: [user] } = await pool.query(
            //$1 = username, $2 = passwordHash
      'INSERT INTO users (user_name, password_hash) VALUES ($1, $2) RETURNING user_id, user_name, created_at',
      [user_name, passwordHash]
    );
        res.json(user);
    } catch (err) {
        //If error send http 400 error code with an error message
        res.status(400).json({ error: err.message });
    }

});

router.post('/signin', async (req, res) => {
  const { user_name, password } = req.body;
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  try {
    const { rows: [user] } = await pool.query(
      'SELECT * FROM users WHERE user_name=$1',
      [user_name]
    );

    if (!user) return res.status(400).json({ error: 'Username does not exist' });
    if (user.password_hash !== passwordHash) return res.status(400).json({ error: 'Password does not match' });

    res.json({ user_id: user.user_id, user_name: user.user_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Now to get all repositories of a user, :userrId is a parameter sent in the url
router.get('/repos/:userId', async (req, res) => {
    //same idea as above we will now get instead of post
    const { userId } = req.params;
    try{
     const { rows } = await pool.query(`
    SELECT r.repo_id, r.name, r.description, rp.permission
    FROM repository r
    JOIN repopermission rp ON r.repo_id = rp.repo_id
    WHERE rp.user_id = $1
  `, [userId]);
        res.json(rows);
}
    catch (err){
        res.status(500).json({ error: err.message });
    }
});


//Getting all the users in the database
router.get('/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT user_id, user_name FROM users ORDER BY user_name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get collaborators for repo
router.get('/repos/:repoId/collaborators', async (req, res) => {
  const { repoId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.user_name, rp.permission
       FROM repopermission rp
       JOIN users u ON rp.user_id = u.user_id
       WHERE rp.repo_id = $1`,
      [repoId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Now to create a new repository

router.post('/repos/create', async (req, res) => {
  const { owner_id, name, description } = req.body;
  try {
    const { rows: [repo] } = await pool.query(
      `INSERT INTO repository (name, description, owner_id) VALUES ($1, $2, $3) RETURNING repo_id`,
      [name, description, owner_id]
    );

    // Add owner permission
    await pool.query(
      `INSERT INTO repopermission (user_id, repo_id, permission) VALUES ($1, $2, $3)`,
      [owner_id, repo.repo_id, 'Owner']
    );
    
    // --- Insert root tree for the new repo ---
    const { rows: [rootTree] } = await pool.query(
      `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
      [crypto.randomBytes(20).toString('hex'), repo.repo_id]
    );

    res.json({ ...repo, root_tree_id: rootTree.tree_id });

   } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Add collaborator 
router.post('/repos/:repoId/collaborators', async (req, res) => {
  const { repoId } = req.params;
  const { user_name, permission } = req.body;

  if (!user_name || !permission) return res.status(400).json({ error: 'Missing fields' });

  try {
    const { rows: [user] } = await pool.query(
      'SELECT user_id FROM users WHERE user_name = $1', [user_name]
    );

    if (!user) return res.status(404).json({ error: 'User not found' });
    // If user exists, add or update permission
    await pool.query(
      `INSERT INTO repopermission (user_id, repo_id, permission)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, repo_id) DO UPDATE SET permission = EXCLUDED.permission`,
      [user.user_id, repoId, permission]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



// Store blob content on disk
async function storeBlobFile(repoId, hash, buffer) {
  const folder = hash.substring(0, 2);
  const rest = hash.substring(2);
  const storageDir = path.join(__dirname, 'repo_storage', String(repoId), 'objects', folder);
  await fs.ensureDir(storageDir);
  const finalPath = path.join(storageDir, rest);
  if (!await fs.pathExists(finalPath)) await fs.writeFile(finalPath, buffer);
  return finalPath;
}

async function processUploadedFilesAsFolder(repoId, files) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert root tree
    const rootTreeId = (await client.query(
      `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
      [crypto.randomBytes(20).toString('hex'), repoId]
    )).rows[0].tree_id;
    console.log(`Created root tree for repoId=${repoId} => treeId=${rootTreeId}`);

    const treeMap = new Map();
    treeMap.set('', rootTreeId);

    // --- Folder helper with logging ---
    async function ensureDirTree(repoId, client, rootTreeId, pathParts) {
      let curTreeId = rootTreeId;
      
      for (const part of pathParts) {
        const existingChild = await client.query(
          `SELECT child_tree_id FROM tree_entry WHERE tree_id = $1 AND name = $2 AND mode = 'tree'`,
          [curTreeId, part]
        );

        if (existingChild.rows.length) {
          curTreeId = existingChild.rows[0].child_tree_id;
          console.log(`Folder exists: '${part}' under treeId=${curTreeId}`);
          continue;
        }

        const childTreeId = (await client.query(
          `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
          [crypto.randomBytes(20).toString('hex'), repoId]
        )).rows[0].tree_id;

        await client.query(
          `INSERT INTO tree_entry (tree_id, name, mode, child_tree_id) VALUES ($1, $2, 'tree', $3)`,
          [curTreeId, part, childTreeId]
        );

        console.log(`Created folder: '${part}' under treeId=${curTreeId} => childTreeId=${childTreeId}`);

        curTreeId = childTreeId;
      }

      return curTreeId;
    }

    // --- Process files with logging ---
    for (const file of files) {
  // Normalize path: replace backslashes, remove leading/trailing slashes, collapse multiple slashes
  let relPath = file.originalname.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  
  const parts = relPath.split('/').filter(p => p !== '');
  if (parts.length === 0) continue;

  const fileName = parts.pop(); // last part is file name
  const dirParts = parts;       // remaining parts are folder path

  console.log(`Processing file '${fileName}' in path '${dirParts.join('/')}'`);

  const parentTreeId = dirParts.length === 0 
    ? rootTreeId 
    : await ensureDirTree(repoId, client, rootTreeId, dirParts);

  const hash = crypto.createHash('sha1').update(file.buffer).digest('hex');
  const objectPath = await storeBlobFile(repoId, hash, file.buffer);

  const blobRes = await client.query(
    `INSERT INTO blob (hash, content_path, size) VALUES ($1, $2, $3)
     ON CONFLICT (hash) DO NOTHING RETURNING blob_id`,
    [hash, objectPath, file.size]
  );

  let blobId = blobRes.rows.length ? blobRes.rows[0].blob_id :
               (await client.query('SELECT blob_id FROM blob WHERE hash=$1', [hash])).rows[0].blob_id;

  await client.query(
    `INSERT INTO tree_entry (tree_id, name, mode, blob_id)
     VALUES ($1, $2, 'blob', $3)
     ON CONFLICT (tree_id, name) DO UPDATE SET blob_id = EXCLUDED.blob_id`,
    [parentTreeId, fileName, blobId]
  );

  console.log(`Added file '${fileName}' => blobId=${blobId} under treeId=${parentTreeId}`);
}

    await client.query('COMMIT');
    return rootTreeId;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during processUploadedFilesAsFolder:', err);
    throw err;
  } finally {
    client.release();
  }
}router.post('/repos/:repoId/upload-folder', upload.array('files'), async (req, res) => {
  const { repoId } = req.params;
  const files = req.files;
  
  // --- NEW: Get message and user ID from the form ---
  const { filePathsJson, uploaded_by, message } = req.body;
  const owner_id = uploaded_by; // 'uploaded_by' is the user.user_id

  if (!owner_id) {
    // This is a critical error, but the transaction is already committed.
    // We can't roll back, but we can log it and tell the user.
    console.error("CRITICAL: Commit failed. 'owner_id' was missing.");
    return res.status(400).json({ error: "User ID was missing, commit failed." });
  }
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  if (!filePathsJson) {
    return res.status(400).json({ error: 'Missing file paths' });
  }

  const relativePaths = JSON.parse(filePathsJson);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // --- REMOVED: We no longer look for the *existing* root tree ---
    // We create a NEW root tree for this snapshot
    const { rows: [newRoot] } = await client.query(
      `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
      [crypto.randomBytes(20).toString('hex'), repoId]
    );
    const rootTreeId = newRoot.tree_id;
    console.log(`Created new snapshot tree for repoId=${repoId} => treeId=${rootTreeId}`);

    // --- Folder helper (This logic is unchanged) ---
    async function ensureDirTree(pathParts) {
      let curTreeId = rootTreeId;
      for (const part of pathParts) {
        const { rows: existingChild } = await client.query(
          `SELECT child_tree_id FROM tree_entry WHERE tree_id=$1 AND name=$2 AND mode='tree'`,
          [curTreeId, part]
        );

        if (existingChild.length) {
          curTreeId = existingChild[0].child_tree_id;
          continue;
        }

        const childTreeId = (await client.query(
          `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
          [crypto.randomBytes(20).toString('hex'), repoId]
        )).rows[0].tree_id;

        await client.query(
          `INSERT INTO tree_entry (tree_id, name, mode, child_tree_id) VALUES ($1, $2, 'tree', $3)`,
          [curTreeId, part, childTreeId]
        );

        curTreeId = childTreeId;
      }
      return curTreeId;
    }

    // --- Process files (This logic is unchanged) ---
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = relativePaths[i];

      const parts = relPath.replace(/\\/g, '/').split('/').filter(p => p !== '');
      if (!parts.length) continue;

      const fileName = parts.pop();
      const dirParts = parts;

      const parentTreeId = dirParts.length === 0
        ? rootTreeId
        : await ensureDirTree(dirParts);

      const hash = crypto.createHash('sha1').update(file.buffer).digest('hex');
      const objectPath = await storeBlobFile(repoId, hash, file.buffer);

      const blobRes = await client.query(
        `INSERT INTO blob (hash, content_path, size) VALUES ($1, $2, $3)
         ON CONFLICT (hash) DO NOTHING RETURNING blob_id`,
        [hash, objectPath, file.size]
      );

      const blobId = blobRes.rows.length
        ? blobRes.rows[0].blob_id
        : (await client.query('SELECT blob_id FROM blob WHERE hash=$1', [hash])).rows[0].blob_id;

      await client.query(
        `INSERT INTO tree_entry (tree_id, name, mode, blob_id)
         VALUES ($1, $2, 'blob', $3)
         ON CONFLICT (tree_id, name) DO UPDATE SET blob_id = EXCLUDED.blob_id`,
        [parentTreeId, fileName, blobId]
      );

      console.log(`Added file '${fileName}' => blobId=${blobId} under treeId=${parentTreeId}`);
    }

    // --- All file/tree entries are in the database, commit the transaction ---
    await client.query('COMMIT');

    // --- NEW: Create the Commit record to log this snapshot ---
    const commitHash = crypto.createHash('sha1').update(`commit-${rootTreeId}-${Date.now()}`).digest('hex');
    await pool.query( // Use 'pool' here, transaction is over
      `INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [commitHash, repoId, rootTreeId, owner_id, message || 'No commit message']
    );
    console.log(`Created commit for treeId=${rootTreeId}`);
    // --- END NEW ---

    res.json({ success: true, root_tree_id: rootTreeId });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('upload-folder error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get all files/folders for a repo
router.get('/repos/:repoId/files', async (req, res) => {
  const { repoId } = req.params;

  try {
    let rootTreeId = null;

    // --- NEW: Find the tree from the LATEST commit ---
    const { rows: latestCommit } = await pool.query(
      `SELECT tree_id FROM Commit 
       WHERE repo_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [repoId]
    );

    if (latestCommit.length > 0) {
      //  We found a commit, use its tree 
      rootTreeId = latestCommit[0].tree_id;
    } else {
      //  No commits yet (new repo), find the initial empty tree 
      const { rows: rootRows } = await pool.query(
        `SELECT tree_id FROM tree WHERE repo_id=$1 ORDER BY tree_id LIMIT 1`,
        [repoId]
      );
      if (rootRows.length) {
        rootTreeId = rootRows[0].tree_id;
      }
    }
    //  END NEW 

    if (rootTreeId === null) {
      // This repo is empty and has no trees
      return res.json({ root_tree_id: null, entries: [] });
    }

    const { rows: entries } = await pool.query(
      `WITH RECURSIVE file_tree AS (
         -- Start with the root tree
         SELECT tree_id, name, mode, child_tree_id, blob_id
         FROM tree_entry
         WHERE tree_id = $1
         
         UNION ALL
         
         -- Recursively find all children
         SELECT te.tree_id, te.name, te.mode, te.child_tree_id, te.blob_id
         FROM tree_entry te
         INNER JOIN file_tree ft ON te.tree_id = ft.child_tree_id
       )
       SELECT 
         ft.tree_id, 
         ft.name, 
         ft.mode, 
         ft.child_tree_id, 
         ft.blob_id, 
         b.hash AS blob_hash, 
         b.size AS blob_size
       FROM file_tree ft
       LEFT JOIN blob b ON ft.blob_id = b.blob_id;`,
      [rootTreeId]
    );

    const formatted = entries.map(e => ({
      tree_id: e.tree_id,
      name: e.name,
      mode: e.mode,
      child_tree_id: e.child_tree_id,
      blob: e.mode === 'blob' ? { blob_id: e.blob_id, hash: e.blob_hash, size: e.blob_size } : null
    }));

    res.json({ root_tree_id: rootTreeId, entries: formatted });

  } catch (err) {
    console.error('GET files error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET ALL FILES FOR A SPECIFIC TREE
router.get('/repos/:repoId/tree/:treeId', async (req, res) => {
  const { treeId } = req.params;

  try {
    const { rows: entries } = await pool.query(
      `WITH RECURSIVE file_tree AS (
         SELECT tree_id, name, mode, child_tree_id, blob_id
         FROM tree_entry
         WHERE tree_id = $1

         UNION ALL

         SELECT te.tree_id, te.name, te.mode, te.child_tree_id, te.blob_id
         FROM tree_entry te
         INNER JOIN file_tree ft ON te.tree_id = ft.child_tree_id
       )
       SELECT 
         ft.tree_id, ft.name, ft.mode, ft.child_tree_id, ft.blob_id, 
         b.hash AS blob_hash, b.size AS blob_size
       FROM file_tree ft
       LEFT JOIN blob b ON ft.blob_id = b.blob_id;`,
      [treeId]
    );

    const formatted = entries.map(e => ({
      tree_id: e.tree_id,
      name: e.name,
      mode: e.mode,
      child_tree_id: e.child_tree_id,
      blob: e.mode === 'blob' ? { blob_id: e.blob_id, hash: e.blob_hash, size: e.blob_size } : null
    }));

    res.json({ root_tree_id: treeId, entries: formatted });

  } catch (err) {
    console.error('GET /tree error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/repos/:repoId/blob/:hash', async (req, res) => {
  const { repoId, hash } = req.params;

  try {
    // Find the blob in the database to get its path
    const { rows: [blob] } = await pool.query(
      `SELECT content_path FROM blob WHERE hash = $1`,
      [hash]
    );

    if (!blob) {
      return res.status(404).json({ error: 'Blob not found' });
    }

    // 2. Read the file from disk
    const storageDir = path.resolve(__dirname, 'repo_storage');
    const safePath = path.resolve(blob.content_path);

    if (!safePath.startsWith(storageDir)) {
       return res.status(403).json({ error: 'Forbidden' });
    }

    // 3. Send the file content
    res.sendFile(safePath);

  } catch (err) {
    console.error('GET /blob error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/repos/:repoId/commits', async (req, res) => {
  const { repoId } = req.params;

  try {
    const { rows: commits } = await pool.query(
      `SELECT
         c.commit_id,
         c.tree_id,
         c.message,
         c.created_at,
         u.user_name
       FROM Commit c
       JOIN users u ON c.owner_id = u.user_id
       WHERE c.repo_id = $1
       ORDER BY c.created_at DESC`,
      [repoId]
    );

    res.json(commits);

  } catch (err) {
    console.error('GET /commits error:', err);
    res.status(500).json({ error: err.message });
  }
});


router.get('/repos/:repoId/download', async (req, res) => {
  const { repoId } = req.params;

  try {
    // Get root tree
    const { rows: [rootTree] } = await pool.query(
      `SELECT tree_id FROM tree WHERE repo_id=$1 ORDER BY tree_id LIMIT 1`,
      [repoId]
    );
    if (!rootTree) return res.status(404).json({ error: 'Repo not found' });
    const rootTreeId = rootTree.tree_id;

    res.setHeader("Content-Disposition", `attachment; filename=repo-${repoId}.zip`);
    res.setHeader("Content-Type", "application/zip");

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => res.status(500).send({ error: err.message }));
    archive.pipe(res);

    // Recursive function to add files/folders
    async function addTree(treeId, currentPath = "") {
      const { rows: entries } = await pool.query(
        `SELECT te.name, te.mode, te.child_tree_id, b.content_path AS blob_path
         FROM tree_entry te
         LEFT JOIN blob b ON te.blob_id = b.blob_id
         WHERE te.tree_id=$1`,
        [treeId]
      );

      for (const e of entries) {
        if (e.mode === "tree") {
          await addTree(e.child_tree_id, path.join(currentPath, e.name));
        } else if (e.mode === "blob") {
          archive.file(e.blob_path, { name: path.join(currentPath, e.name) });
        }
      }
    }

    await addTree(rootTreeId);
    archive.finalize();

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
