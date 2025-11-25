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


// ... existing routes ...

// NEW ROUTE: Get recent commits across all repos a user is involved in
router.get('/users/:userId/recent-commits', async (req, res) => {
    const { userId } = req.params;

    try {
        const { rows: commits } = await pool.query(
            `SELECT
                c.commit_id,
                r.name AS repo_name,
                c.message,
                c.created_at AS timestamp,
                u.user_name AS author_name
            FROM
                Commit c
            JOIN
                users u ON c.owner_id = u.user_id
            JOIN
                repository r ON c.repo_id = r.repo_id
            JOIN
                RepoPermission rp ON r.repo_id = rp.repo_id
            WHERE
                rp.user_id = $1
            ORDER BY
                c.created_at DESC
            LIMIT 3`,
            [userId]
        );

        res.json(commits);

    } catch (err) {
        console.error('GET /recent-commits error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Middleware: check if the requesting user can upload to the repo
async function checkUploadPermission(req, res, next) {
  try {
    const repoId = req.params.repoId;
    // support user id in body or header (flexible for frontend)
    const userId = req.body.uploaded_by || req.header('x-user-id');
    if (!userId) return res.status(401).json({ error: 'Missing user id for upload' });

    const { rows } = await pool.query(
      'SELECT permission FROM repopermission WHERE repo_id=$1 AND user_id=$2',
      [repoId, userId]
    );

    if (!rows.length) return res.status(403).json({ error: 'No permission for this repo' });
    const perm = rows[0].permission;
    if (perm !== 'Owner' && perm !== 'Contributor') {
      return res.status(403).json({ error: 'Insufficient permission to upload' });
    }

    next();
  } catch (err) {
    console.error('checkUploadPermission error:', err);
    res.status(500).json({ error: err.message });
  }
}
// This just makes that /signup endpoint will make a post request, req and res means request and response
router.post('/signup', async(req, res) =>{
    //This is the json body that we get from the requst (frontend)
    //Make sure when you parse it the variables are the same as what you send from frontend in .json
    const { user_name, password } = req.body;
    //Just hashing the password
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

    //now insert
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: [user] } = await client.query(
            //$1 = username, $2 = passwordHash
      'INSERT INTO users (user_name, password_hash) VALUES ($1, $2) RETURNING user_id, user_name, created_at',
      [user_name, passwordHash]
    );
        await client.query('COMMIT');
        res.json(user);
    } catch (err) {
        await client.query('ROLLBACK');
        //If error send http 400 error code with an error message
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
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
    const { rows } = await pool.query(`
      SELECT u.user_name, rp.permission, u.user_id 
      FROM RepoPermission rp
      JOIN users u ON rp.user_id = u.user_id
      WHERE rp.repo_id = $1
    `, [repoId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Now to create a new repository
router.post('/repos/create', async (req, res) => {
  const { owner_id, name, description } = req.body;
  try {
    // Call the new stored function
    const { rows: [repo] } = await pool.query(
      `SELECT create_new_repository($1, $2, $3) as repo_id`,
      [name, description, owner_id]
    );
    
    // The function handles the repo, permission, and initial tree creation atomically
    res.json({ repo_id: repo.repo_id }); // Return the newly created ID

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
    // ONE call to the database does everything (Find user + Insert + Audit Log)
    await pool.query(
      `CALL add_collaborator_proc($1, $2, $3)`,
      [repoId, user_name, permission]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    if (err.message.includes('not found')) {
        return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});



// Store blob content on disk
async function storeBlobFile(repoId, hash, buffer) {
  const folder = hash.substring(0, 2);
  const rest = hash.substring(2);
  const storageDir = path.join(__dirname, 'blobs', String(repoId), 'objects', folder);
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
}
router.post('/repos/:repoId/upload-folder', upload.array('files'), checkUploadPermission, async (req, res) => {
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

    // 1. Find the Old Root (from previous commit)
    const { rows: latest } = await client.query(
      `SELECT tree_id FROM Commit WHERE repo_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [repoId]
    );
    const oldRootId = latest.length > 0 ? latest[0].tree_id : null;

    // 2. Create NEW Root Tree
    const { rows: [newRoot] } = await client.query(
      `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
      [crypto.randomBytes(20).toString('hex'), repoId]
    );
    const rootTreeId = newRoot.tree_id;

    // 3. Copy entries from Old Root -> New Root
    if (oldRootId) {
      await client.query(
        `INSERT INTO tree_entry (tree_id, name, mode, blob_id, child_tree_id)
         SELECT $1, name, mode, blob_id, child_tree_id
         FROM tree_entry
         WHERE tree_id = $2`,
        [rootTreeId, oldRootId]
      );
    }

    // --- TRACKING CLONED TREES ---
    // We track which trees we have already cloned in this transaction 
    // so we don't clone the same folder twice if multiple files are in it.
    const clonedTrees = new Set();
    clonedTrees.add(rootTreeId);

    // --- HELPER: Recursive Copy-on-Write ---
    async function ensureDirTree(curTreeId, pathParts) {
      let currentId = curTreeId;
      
      for (const part of pathParts) {
        // Find the child entry in the current tree
        const res = await client.query(
          `SELECT entry_id, child_tree_id FROM tree_entry 
           WHERE tree_id = $1 AND name = $2 AND mode = 'tree'`,
          [currentId, part]
        );

        let childTreeId;

        if (res.rows.length > 0) {
          // Folder exists... BUT is it a copy of the old one?
          const oldChildId = res.rows[0].child_tree_id;

          if (clonedTrees.has(oldChildId)) {
            // We already cloned it in this transaction. Safe to use.
            childTreeId = oldChildId;
          } else {
            // IT IS AN OLD TREE! We must CLONE it to avoid changing history.
            const { rows: [newTree] } = await client.query(
              `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
              [crypto.randomBytes(20).toString('hex'), repoId]
            );
            childTreeId = newTree.tree_id;

            // Copy entries from Old Child -> New Child
            await client.query(
              `INSERT INTO tree_entry (tree_id, name, mode, blob_id, child_tree_id)
               SELECT $1, name, mode, blob_id, child_tree_id
               FROM tree_entry
               WHERE tree_id = $2`,
              [childTreeId, oldChildId]
            );

            // Update Parent to point to New Child
            await client.query(
              `UPDATE tree_entry SET child_tree_id = $1 WHERE tree_id = $2 AND name = $3`,
              [childTreeId, currentId, part]
            );

            // Mark as cloned
            clonedTrees.add(childTreeId);
          }
        } else {
          // Folder doesn't exist at all. Create new.
          const { rows: [newTree] } = await client.query(
            `INSERT INTO tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
            [crypto.randomBytes(20).toString('hex'), repoId]
          );
          childTreeId = newTree.tree_id;

          await client.query(
            `INSERT INTO tree_entry (tree_id, name, mode, child_tree_id) VALUES ($1, $2, 'tree', $3)`,
            [currentId, part, childTreeId]
          );
          clonedTrees.add(childTreeId);
        }

        currentId = childTreeId;
      }
      return currentId;
    }

    // --- Process Files ---
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = relativePaths[i];
      const parts = relPath.replace(/\\/g, '/').split('/').filter(p => p !== '');
      if (!parts.length) continue;

      const fileName = parts.pop();
      const dirParts = parts;

      // Use the smart ensureDirTree
      const parentTreeId = await ensureDirTree(rootTreeId, dirParts);

      const hash = crypto.createHash('sha1').update(file.buffer).digest('hex');
      const objectPath = await storeBlobFile(repoId, hash, file.buffer);

      // Insert Blob
      const blobRes = await client.query(
        `INSERT INTO blob (hash, content_path, size) VALUES ($1, $2, $3)
         ON CONFLICT (hash) DO NOTHING RETURNING blob_id`,
        [hash, objectPath, file.size]
      );
      
      let blobId;
      if (blobRes.rows.length > 0) {
        blobId = blobRes.rows[0].blob_id;
      } else {
        const existing = await client.query('SELECT blob_id FROM blob WHERE hash=$1', [hash]);
        blobId = existing.rows[0].blob_id;
      }

      // Link Blob to Tree
      await client.query(
        `INSERT INTO tree_entry (tree_id, name, mode, blob_id)
         VALUES ($1, $2, 'blob', $3)
         ON CONFLICT (tree_id, name) DO UPDATE SET blob_id = EXCLUDED.blob_id`,
        [parentTreeId, fileName, blobId]
      );
    }

    await client.query('COMMIT');

    // --- Create Commit Record ---
    const commitHash = crypto.createHash('sha1').update(`commit-${rootTreeId}-${Date.now()}`).digest('hex');
    await pool.query(
      `INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [commitHash, repoId, rootTreeId, owner_id, message || 'File upload']
    );

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

    // 1. Find the tree from the LATEST commit
    const { rows: latestCommit } = await pool.query(
      `SELECT tree_id FROM Commit 
       WHERE repo_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [repoId]
    );

    if (latestCommit.length > 0) {
      rootTreeId = latestCommit[0].tree_id;
    } else {
      // Fallback for new/empty repos
      const { rows: rootRows } = await pool.query(
        `SELECT tree_id FROM tree WHERE repo_id=$1 ORDER BY tree_id LIMIT 1`,
        [repoId]
      );
      if (rootRows.length) rootTreeId = rootRows[0].tree_id;
    }

    if (rootTreeId === null) {
      return res.json({ root_tree_id: null, entries: [] });
    }

    // 2. CALL YOUR NEW SQL FUNCTION (Clean & Fast!)
    const { rows: entries } = await pool.query(
      `SELECT * FROM get_file_tree($1)`, 
      [rootTreeId]
    );

    // 3. Format for frontend
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
    // 1. CALL YOUR NEW SQL FUNCTION DIRECTLY
    const { rows: entries } = await pool.query(
      `SELECT * FROM get_file_tree($1)`, 
      [treeId]
    );

    // 2. Format for frontend
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
    const storageDir = path.resolve(__dirname, 'blobs');
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

// ---- NEW ENDPOINT: ROLLBACK TO A PREVIOUS COMMIT ----
// ---- NEW ENDPOINT: ROLLBACK TO A PREVIOUS COMMIT (SECURED) ----
router.post('/repos/:repoId/rollback/:commitId', async (req, res) => {
  const { repoId, commitId } = req.params;
  const { user_id } = req.body; // We need to know WHO is rolling back

  try {
    // --- SECURITY CHECK: OWNER ONLY ---
    // Use the helper function we already created
    const permission = await getUserRepoPermission(repoId, user_id);
    
    if (permission !== 'Owner') {
        console.log(`Blocked rollback attempt by user ${user_id} (Role: ${permission})`);
        return res.status(403).json({ error: "Only Owners can perform a rollback." });
    }
    // ----------------------------------

    // 1. Generate a new hash for this "Revert" commit
    const newHash = crypto.randomBytes(20).toString('hex');
    const message = `Rollback to commit #${commitId}`;

    // 2. Call the Database Procedure
    await pool.query(
      `CALL restore_commit_proc($1, $2, $3, $4, $5)`,
      [repoId, user_id, commitId, newHash, message]
    );

    res.json({ success: true, message: "Rollback successful" });

  } catch (err) {
    console.error('Rollback error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================================================================
// TCL DEMONSTRATION: BULK ADD COLLABORATORS
// Uses: BEGIN, SAVEPOINT, ROLLBACK TO, COMMIT, SET TRANSACTION
// ==================================================================
router.post('/repos/:repoId/collaborators/bulk', async (req, res) => {
  const { repoId } = req.params;
  const { user_names, permission } = req.body;

  if (!user_names || !Array.isArray(user_names)) {
    return res.status(400).json({ error: 'user_names must be an array' });
  }

  // We need a dedicated client for transactions (not the pool directly)
  const client = await pool.connect();

  try {
    // 1. START TRANSACTION (TCL)
    await client.query('BEGIN');

    // 2. SET TRANSACTION ISOLATION LEVEL (TCL)
    // Ensures we see a consistent snapshot of data
    await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');

    const results = { added: [], failed: [] };

    // Loop through users
    for (const userName of user_names) {
      // Create a unique savepoint name for this user iteration
      const savepointName = `sp_${userName.replace(/[^a-zA-Z0-9]/g, '')}`;

      try {
        // 3. CREATE SAVEPOINT (TCL)
        // If the operations below fail, we roll back to HERE, keeping the main transaction alive.
        await client.query(`SAVEPOINT ${savepointName}`);

        // -- Logic: Find User --
        const { rows: users } = await client.query(
          'SELECT user_id FROM users WHERE user_name = $1', 
          [userName]
        );

        if (users.length === 0) {
          throw new Error(`User ${userName} not found`);
        }

        const userId = users[0].user_id;

        // -- Logic: Insert Permission --
        await client.query(
          `INSERT INTO repopermission (user_id, repo_id, permission)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, repo_id) 
           DO UPDATE SET permission = $3`,
          [userId, repoId, permission]
        );

        // Success! Track it.
        results.added.push(userName);

        // 4. RELEASE SAVEPOINT (TCL)
        // Frees up resources for this savepoint
        await client.query(`RELEASE SAVEPOINT ${savepointName}`);

      } catch (innerErr) {
        // 5. ROLLBACK TO SAVEPOINT (TCL)
        // Undo ONLY this user's failure. The transaction continues!
        await client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
        
        console.log(`Skipping ${userName}: ${innerErr.message}`);
        results.failed.push({ user: userName, reason: innerErr.message });
      }
    }

    // 6. COMMIT (TCL)
    // Permanently save all successful operations
    await client.query('COMMIT');

    res.json({ 
      success: true, 
      message: "Bulk process complete", 
      results 
    });

  } catch (err) {
    // Catastrophic failure (DB crash, etc) -> Undo everything
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==================================================================
// DIFFING: COMPARE COMMIT WITH PARENT
// ==================================================================
router.get('/repos/:repoId/diff/:commitId', async (req, res) => {
  const { repoId, commitId } = req.params;

  try {
    // 1. Get the Current Commit and its Tree
    const { rows: [current] } = await pool.query(
      `SELECT tree_id, created_at FROM Commit WHERE commit_id = $1`,
      [commitId]
    );
    if (!current) return res.status(404).json({ error: 'Commit not found' });

    // 2. Find the Previous Commit (Parent)
    // We select the most recent commit that happened BEFORE this one
    const { rows: [parent] } = await pool.query(
      `SELECT tree_id FROM Commit 
       WHERE repo_id = $1 AND created_at < $2 
       ORDER BY created_at DESC LIMIT 1`,
      [repoId, current.created_at]
    );

    // 3. Helper to flatten a tree into a simple map: { "path/to/file": "hash" }
    async function getFlatFileMap(treeId) {
      if (!treeId) return {};
      
      // CALL THE NEW SQL FUNCTION (get_diff_manifest)
      const { rows } = await pool.query(`SELECT * FROM get_diff_manifest($1)`, [treeId]);
      
      const map = {};
      rows.forEach(r => {
        // Key by the FULL PATH (e.g. "src/components/App.js")
        map[r.file_path] = { hash: r.blob_hash, name: r.file_path };
      });
      return map;
    }

    // 4. Get files for both versions
    const currentFiles = await getFlatFileMap(current.tree_id);
    const parentFiles = await getFlatFileMap(parent ? parent.tree_id : null);

    // 5. Compare them (The Diff Logic)
    const changes = [];

    // Check for Modified and Added
    for (const [name, file] of Object.entries(currentFiles)) {
      const oldFile = parentFiles[name];
      
      if (!oldFile) {
        changes.push({ type: 'added', name, newHash: file.hash, oldHash: null });
      } else if (oldFile.hash !== file.hash) {
        changes.push({ type: 'modified', name, newHash: file.hash, oldHash: oldFile.hash });
      }
      // If hashes match, it's 'unchanged', so we skip it.
    }

    // Check for Deleted
    for (const [name, file] of Object.entries(parentFiles)) {
      if (!currentFiles[name]) {
        changes.push({ type: 'deleted', name, newHash: null, oldHash: file.hash });
      }
    }

    res.json({ 
      parent_found: !!parent,
      changes 
    });

  } catch (err) {
    console.error('Diff error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Add this utility function near the top of routes.js
async function getUserRepoPermission(repoId, userId) {
  // 1. Check if user is the Owner
  const ownerRes = await pool.query(
    'SELECT owner_id FROM REPOSITORY WHERE repo_id = $1',
    [repoId]
  );
  if (ownerRes.rows.length > 0 && ownerRes.rows[0].owner_id === userId) {
    return 'Owner';
  }

  // 2. Check RepoPermission table
  const collabRes = await pool.query(
    'SELECT permission FROM RepoPermission WHERE repo_id = $1 AND user_id = $2',
    [repoId, userId]
  );
  if (collabRes.rows.length > 0) {
    return collabRes.rows[0].permission;
  }

  return null; // Not linked
}

// ==================================================================
// ROLLBACK REQUEST WORKFLOW (Contributor Request -> Owner Approve)
// ==================================================================

// 1. CREATE A ROLLBACK REQUEST (For Contributors)
router.post('/repos/:repoId/rollback-request', async (req, res) => {
  const { repoId } = req.params;
  const { user_id, commit_id } = req.body;

  try {
    // Check permission (Must be at least Contributor)
    const permission = await getUserRepoPermission(repoId, user_id);
    if (!permission || permission === 'Viewer') {
        return res.status(403).json({ error: "Viewers cannot request changes." });
    }

    await pool.query(
      `INSERT INTO Rollback_Request (repo_id, commit_id, requester_id) VALUES ($1, $2, $3)`,
      [repoId, commit_id, user_id]
    );

    res.json({ success: true, message: "Request sent to Owner." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET PENDING REQUESTS (For Owners to see)
router.get('/repos/:repoId/rollback-requests', async (req, res) => {
  const { repoId } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT rr.request_id, rr.commit_id, rr.created_at, u.user_name, c.message as commit_message
      FROM Rollback_Request rr
      JOIN users u ON rr.requester_id = u.user_id
      JOIN Commit c ON rr.commit_id = c.commit_id
      WHERE rr.repo_id = $1 AND rr.status = 'Pending'
      ORDER BY rr.created_at DESC
    `, [repoId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. PROCESS REQUEST (Approve/Reject) - OWNER ONLY
router.post('/repos/:repoId/rollback-requests/:requestId', async (req, res) => {
  const { repoId, requestId } = req.params;
  const { action, owner_id } = req.body; // action: 'approve' or 'reject'

  try {
    // Security Check
    const permission = await getUserRepoPermission(repoId, owner_id);
    if (permission !== 'Owner') return res.status(403).json({ error: "Only Owners can approve." });

    if (action === 'reject') {
        await pool.query(`DELETE FROM Rollback_Request WHERE request_id = $1`, [requestId]);
        return res.json({ success: true, message: "Request rejected." });
    }

    if (action === 'approve') {
        // 1. Get details from the request
        const { rows: [reqData] } = await pool.query(
            `SELECT commit_id FROM Rollback_Request WHERE request_id = $1`, 
            [requestId]
        );
        if (!reqData) return res.status(404).json({ error: "Request not found" });

        // 2. EXECUTE ROLLBACK (Call the Stored Procedure)
        const newHash = crypto.randomBytes(20).toString('hex');
        const message = `Rollback to commit #${reqData.commit_id} (Approved)`;
        
        await pool.query(
            `CALL restore_commit_proc($1, $2, $3, $4, $5)`,
            [repoId, owner_id, reqData.commit_id, newHash, message]
        );

        // 3. Delete the request (it's done)
        await pool.query(`DELETE FROM Rollback_Request WHERE request_id = $1`, [requestId]);

        return res.json({ success: true, message: "Rollback approved and executed." });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================================================================
// SEARCH & QUERY: FILTER COMMITS
// Allows searching by Keyword (Message/Author) and Date Range
// ==================================================================
router.get('/repos/:repoId/search-commits', async (req, res) => {
  const { repoId } = req.params;
  const { keyword, startDate, endDate } = req.query;

  try {
    // 1. Start building the query
    let queryText = `
      SELECT
         c.commit_id,
         c.message,
         c.created_at,
         u.user_name
      FROM Commit c
      JOIN users u ON c.owner_id = u.user_id
      WHERE c.repo_id = $1
    `;
    
    const queryParams = [repoId];
    let paramIndex = 2; // Start at $2 because $1 is repoId

    // 2. Add Keyword Filter (Message or Username)
    if (keyword) {
      queryText += ` AND (c.message ILIKE $${paramIndex} OR u.user_name ILIKE $${paramIndex})`;
      queryParams.push(`%${keyword}%`); // Add wildcards for partial matching
      paramIndex++;
    }

    // 3. Add Date Range Filter
    if (startDate) {
      queryText += ` AND c.created_at >= $${paramIndex}`;
      queryParams.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      // Add 1 day to include the full end date
      queryText += ` AND c.created_at <= $${paramIndex}::date + 1`; 
      queryParams.push(endDate);
      paramIndex++;
    }

    // 4. Finish Query
    queryText += ` ORDER BY c.created_at DESC`;

    // 5. Execute
    const { rows: commits } = await pool.query(queryText, queryParams);
    res.json(commits);

  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================================================================
// ANALYTICS & AI MODULE
// ==================================================================
const Sentiment = require('sentiment');
const sentiment = new Sentiment();

router.get('/repos/:repoId/analytics', async (req, res) => {
  const { repoId } = req.params;

  try {
    // 1. Get Activity Stats (SQL Aggregation)
    const { rows: activity } = await pool.query(
      `SELECT * FROM get_commit_activity($1)`,
      [repoId]
    );

    // 2. Get AI Sentiment Analysis on Commit History
    // We score the commit messages
    const { rows: commits } = await pool.query(
      `SELECT c.message, c.created_at, u.user_name 
       FROM Commit c JOIN users u ON c.owner_id = u.user_id
       WHERE c.repo_id = $1 ORDER BY c.created_at ASC`, 
      [repoId]
    );

    const sentimentData = commits.map(c => {
      const analysis = sentiment.analyze(c.message);
      return {
        date: c.created_at,
        author: c.user_name,
        message: c.message,
        score: analysis.score, // >0 (Positive), <0 (Negative), 0 (Neutral)
        comparative: analysis.comparative // Score adjusted for length
      };
    });

    // 3. Get Code Clones (Type 1)
    const { rows: [latest] } = await pool.query(
        `SELECT tree_id FROM Commit WHERE repo_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [repoId]
    );
    
    let clones = [];
    if (latest) {
        const { rows: cloneRows } = await pool.query(
            `SELECT * FROM get_code_clones($1)`, 
            [latest.tree_id]
        );
        clones = cloneRows;
    }

    res.json({
      activity,
      sentiment: sentimentData,
      clones
    });

  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});


// DELETE /repos/:repoId
router.delete('/repos/:repoId', async (req, res) => {
  const { repoId } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Call the procedure to delete repo + dependent DB rows.
    // It RETURNS rows (deleted_content_path) for files to delete from disk.
    const { rows } = await client.query('SELECT deleted_content_path FROM delete_repository_proc($1)', [repoId]);

    await client.query('COMMIT');

    // rows is an array of { deleted_content_path: '/path/to/file' }
    // Delete each file; log failures but don't try to rollback DB (DB already committed).
    const deletedPaths = rows.map(r => r.deleted_content_path).filter(Boolean);

    for (const p of deletedPaths) {
      try {
        // Make sure path is resolved within your blobs directory
        const safePath = path.resolve(__dirname, p);
        const blobsDir = path.resolve(__dirname, 'blobs');

        if (!safePath.startsWith(blobsDir)) {
          console.warn('Skipping unsafe blob path:', safePath);
          continue;
        }

        // remove file (if present)
        await fs.remove(safePath);
      } catch (fileErr) {
        // Log but continue: DB is already committed. Consider alerting/monitoring.
        console.error('Failed to remove blob file', p, fileErr);
      }
    }

    // Finally, remove the repo's blobs folder if it exists (cleans leftover structure)
    try {
      const repoFolder = path.join(__dirname, 'blobs', String(repoId));
      await fs.remove(repoFolder);
    } catch (folderErr) {
      console.error('Failed to remove repo blobs folder:', folderErr);
    }

    res.json({ success: true, deleted_files: deletedPaths.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /repos error:', err);
    if (err.code && err.code.startsWith('P')) {
      // DB related error
    }
    // If the error was the repository not found (from the function exception),
    // return 404 for clarity
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
// routes.js (Updated with deletion logic and SQL fix)

// Assuming necessary imports like 'express', 'Pool', and 'crypto' are present
// const express = require('express');
// const router = express.Router();
// const { Pool } = require('pg');
// const crypto = require('crypto');
// const pool = new Pool({...});

// ===============================================
// HELPER FUNCTION: Recursively Rebuild Tree (for deletion)
// ===============================================

/**
 * Recursively reconstructs the tree after a deletion.
 * Creates new Tree records for all affected parent directories (content-addressable).
 *
 * @param {object} client - The active PG transaction client.
 * @param {number} repoId - The repository ID.
 * @param {number} currentTreeId - The ID of the tree to search within (recursively).
 * @param {string[]} pathSegments - The remaining path to the item to delete (e.g., ['components', 'Button.jsx']).
 * @returns {Promise<number>} - The new ID of the updated tree.
 * @throws {Error} - If the item to delete is not found or is a file in the middle of a path.
 */
async function rebuildTreeAfterDeletion(client, repoId, currentTreeId, pathSegments) {
    const segmentName = pathSegments[0];
    const isTarget = pathSegments.length === 1;

    // 1. Fetch all entries of the current tree (FIX: Using child_tree_id)
    const { rows: entries } = await client.query(
        `SELECT
            te.name, te.mode, te.blob_id, te.child_tree_id AS linked_tree_id
         FROM Tree_Entry te
         WHERE te.tree_id = $1
         ORDER BY te.name`,
        [currentTreeId]
    );

    // Filter out the entry to be deleted if we are at the target level
    let updatedEntries = entries.filter(entry => entry.name !== segmentName);

    // Find the entry that corresponds to the current segment
    const targetEntry = entries.find(entry => entry.name === segmentName);

    if (!targetEntry) {
        throw new Error(`Item not found: ${pathSegments.join('/')}`);
    }

    if (!isTarget) {
        // Case 2: The item is deeper in the structure (target is a subdirectory).
        if (targetEntry.mode !== 'tree' || !targetEntry.linked_tree_id) {
             throw new Error(`Path segment '${segmentName}' is not a folder, but expected a folder for path traversal.`);
        }

        // Recursively call for the next level
        const newSubTreeId = await rebuildTreeAfterDeletion(
            client,
            repoId,
            targetEntry.linked_tree_id,
            pathSegments.slice(1) // Pass the rest of the path
        );

        // Create a new entry pointing to the new subtree
        const newTargetEntry = {
            name: targetEntry.name,
            mode: targetEntry.mode, // 'tree'
            blob_id: null,
            linked_tree_id: newSubTreeId
        };
        
        // Add the updated entry back into the list
        updatedEntries.push(newTargetEntry);
        updatedEntries.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    // 2. Calculate the hash of the new tree's content
    const treeContent = updatedEntries.map(entry =>
        `${entry.mode}:${entry.linked_tree_id || entry.blob_id}:${entry.name}`
    ).join('\n');
    
    // Assuming crypto is available via `const crypto = require('crypto');`
    const newTreeHash = crypto.createHash('sha1').update(treeContent).digest('hex');

    // 3. Check for existing tree with this hash (Content-addressability)
    const { rows: existingTree } = await client.query(
        `SELECT tree_id FROM Tree WHERE repo_id = $1 AND hash = $2`,
        [repoId, newTreeHash]
    );

    if (existingTree.length > 0) {
        // Tree content is identical to an existing tree, reuse its ID
        return existingTree[0].tree_id;
    }

    // 4. Insert the new Tree record
    const { rows: newTreeRow } = await client.query(
        `INSERT INTO Tree (repo_id, hash) VALUES ($1, $2) RETURNING tree_id`,
        [repoId, newTreeHash]
    );
    const newTreeId = newTreeRow[0].tree_id;

    // 5. Insert new Tree_Entry records for the new tree (FIX: Using child_tree_id)
    for (const entry of updatedEntries) {
        await client.query(
            `INSERT INTO Tree_Entry (tree_id, name, mode, blob_id, child_tree_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                newTreeId, 
                entry.name, 
                entry.mode, 
                entry.mode === 'blob' ? entry.blob_id : null, 
                entry.mode === 'tree' ? entry.linked_tree_id : null
            ]
        );
    }

    return newTreeId;
}


// ===============================================
// NEW ROUTE: POST /repos/:repoId/delete-item
// ===============================================

router.post('/repos/:repoId/delete-item', async (req, res) => {
    const { repoId } = req.params;
    const { path: pathToDelete, message } = req.body;
    const pathSegments = pathToDelete.split('/'); 
    
    const currentUserId = 1; // Placeholder for the committer's ID (should be auth-derived)

    if (!pathToDelete || !message) {
        return res.status(400).json({ error: 'Missing path or commit message.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get the latest commit and root tree ID
        const { rows: latestCommitRows } = await client.query(
            `SELECT
                c.commit_id, c.tree_id
             FROM Commit c
             WHERE c.repo_id = $1
             ORDER BY c.created_at DESC, c.commit_id DESC
             LIMIT 1`,
            [repoId]
        );

        if (latestCommitRows.length === 0) {
             throw new Error('Repository is empty or not found. Cannot perform deletion.');
        }

        const latestCommit = latestCommitRows[0];
        const currentRootTreeId = latestCommit.tree_id;

        // 2. Rebuild the tree structure after deletion
        const newRootTreeId = await rebuildTreeAfterDeletion(
            client,
            repoId,
            currentRootTreeId,
            pathSegments
        );
        
        // Check if the deletion actually resulted in a change
        if (newRootTreeId === currentRootTreeId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'No change detected. The item may not exist or the operation resulted in an identical tree structure.' });
        }

        const commitContent = `${newRootTreeId}:${latestCommit.commit_id}:${message}:${currentUserId}:${Date.now()}`;
        const commitHash = crypto.createHash('sha1').update(commitContent).digest('hex');

        // 3. Create the new commit record
        const { rows: newCommitRow } = await client.query(
            `INSERT INTO Commit (repo_id, tree_id, hash, message, owner_id)
             VALUES ($1, $2, $3, $4, $5) RETURNING commit_id`,
            [repoId, newRootTreeId, commitHash, message, currentUserId]
        );
        const newCommitId = newCommitRow[0].commit_id;

        // 4. Link the new commit to the old commit (its parent)
        await client.query(
            `INSERT INTO Commit_Parent (commit_id, parent_commit)
             VALUES ($1, $2)`,
            [newCommitId, latestCommit.commit_id]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, commit_id: newCommitId, message: `Committed deletion of ${pathToDelete}` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`POST /repos/${repoId}/delete-item error:`, err);
        // Handle Item not found error
        if (err.message && (err.message.includes('Item not found') || err.message.includes('not a folder'))) {
             return res.status(404).json({ error: err.message });
        }
        res.status(500).json({ error: 'Failed to create commit for deletion.' });
    } finally {
        client.release();
    }
});

// ... rest of your routes ...
module.exports = router;

