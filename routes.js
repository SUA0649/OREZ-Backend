// ---- Getting libraries ----
const express = require('express');
const { Pool } = require('pg');
// Pool used for multiple queries with repeatidly opening / closing connections
const crypto = require('crypto'); // For hashing 
const router = express.Router(); // Creating router instance
// ----------------------------


// ---- Setting up database connection pool ----
// Every subquery will use the below configuratoion to connect to the database
const pool = new Pool({
  user: 'orez',
  host: 'localhost',
  database: 'appdb',
  password: '1231231',
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

    res.json(repo);
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



module.exports = router;