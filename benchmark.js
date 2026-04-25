const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  user: 'orez',
  host: 'localhost',
  database: 'appdb',
  password: '123',
  port: 5432,
});

async function runBenchmark() {
  const client = await pool.connect();
  try {
    console.log("==================================================");
    console.log("             OREZ BENCHMARK TEST              ");
    console.log("==================================================\n");

    // --- SETUP PHASE ---
    process.stdout.write("⚙️  Seeding database with mock data... ");
    const { rows: [user] } = await client.query(
      `INSERT INTO users (user_name, password_hash) VALUES ($1, 'testhash') 
       ON CONFLICT (user_name) DO UPDATE SET password_hash='testhash' RETURNING user_id`,
      [`bench_user_${Date.now()}`]
    );
    const userId = user.user_id;

    const { rows: [repo] } = await client.query(
      `INSERT INTO REPOSITORY (name, description, owner_id) VALUES ($1, 'bench repo', $2) RETURNING repo_id`,
      [`bench_repo_${Date.now()}`, userId]
    );
    const repoId = repo.repo_id;

    const { rows: [tree] } = await client.query(
      `INSERT INTO Tree (hash, repo_id) VALUES ($1, $2) RETURNING tree_id`,
      [`tree_${Date.now()}`, repoId]
    );
    const treeId = tree.tree_id;

    let values = [];
    for (let i = 0; i < 5000; i++) {
      const daysAgo = Math.floor(Math.random() * 30);
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      values.push(`('${crypto.randomBytes(10).toString('hex')}', ${repoId}, ${treeId}, ${userId}, 'bench commit', '${date.toISOString()}')`);
      if (values.length >= 1000) {
        await client.query(`INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message, created_at) VALUES ${values.join(',')}`);
        values = [];
      }
    }
    console.log("Done (5000 commits added).\n");

    // --- METRIC 1: QUERY EXECUTION TIME ---
    console.log("📊 METRIC 1: QUERY PERFORMANCE");
    console.log("--------------------------------------------------");

    const extractTime = (explainOutput, keyword) => {
      const line = explainOutput.find(row => row['QUERY PLAN'].includes(keyword));
      return line ? line['QUERY PLAN'].split(': ')[1] : 'N/A';
    };

    // Query 1: Commit Activity Analytics
    const q1Res = await client.query(`
        EXPLAIN ANALYZE SELECT DATE(created_at) as day, COUNT(*) as cnt FROM Commit WHERE repo_id = ${repoId} GROUP BY DATE(created_at) ORDER BY day ASC;
    `);
    console.log(`- Analytics Query (Commit Activity):`);
    console.log(`    ↳ Planning Time:  ${extractTime(q1Res.rows, 'Planning Time')}`);
    console.log(`    ↳ Execution Time: ${extractTime(q1Res.rows, 'Execution Time')}`);

    // Query 2: Commit History Fetch
    const q2Res = await client.query(`
        EXPLAIN ANALYZE SELECT * FROM Commit WHERE repo_id = ${repoId} ORDER BY created_at DESC LIMIT 50;
    `);
    console.log(`- Fetch Recent Commits:`);
    console.log(`    ↳ Planning Time:  ${extractTime(q2Res.rows, 'Planning Time')}`);
    console.log(`    ↳ Execution Time: ${extractTime(q2Res.rows, 'Execution Time')}\n`);


    // --- METRIC 2: WRITE THROUGHPUT ---
    console.log("⚡ METRIC 2: WRITE THROUGHPUT (Sequential)");
    console.log("--------------------------------------------------");
    const writeStart = Date.now();
    for (let i = 0; i < 100; i++) {
      await client.query(`INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message) VALUES ('${crypto.randomBytes(10).toString('hex')}', ${repoId}, ${treeId}, ${userId}, 'throughput test')`);
    }
    const writeEnd = Date.now();
    const writeTime = writeEnd - writeStart;
    console.log(`- 100 sequential commit inserts took: ${writeTime}ms`);
    console.log(`- Throughput: ${((100 / writeTime) * 1000).toFixed(2)} inserts/sec\n`);


    // --- METRIC 3: CONCURRENCY & ISOLATION ---
    console.log("🚦 METRIC 3: CONCURRENCY STRESS TEST");
    console.log("--------------------------------------------------");
    const concStart = Date.now();
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(client.query(`INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message) VALUES ('${crypto.randomBytes(10).toString('hex')}', ${repoId}, ${treeId}, ${userId}, 'concurrent test')`));
    }
    await Promise.all(promises);
    const concEnd = Date.now();
    console.log(`- 100 parallel commit requests handled in: ${concEnd - concStart}ms\n`);

    console.log("🚦 METRIC 4: ISOLATION CONFLICT TEST (SERIALIZABLE)");
    console.log("--------------------------------------------------");
    // To prove SERIALIZABLE works, we need two separate connections
    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      await client1.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client2.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      // Both read the same state
      await client1.query(`SELECT count(*) FROM Commit WHERE repo_id=${repoId}`);
      await client2.query(`SELECT count(*) FROM Commit WHERE repo_id=${repoId}`);

      // Both try to write based on that state
      await client1.query(`INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message) VALUES ('12345', ${repoId}, ${treeId}, ${userId}, 'Client 1 Update')`);
      await client2.query(`INSERT INTO Commit (hash, repo_id, tree_id, owner_id, message) VALUES ('67890', ${repoId}, ${treeId}, ${userId}, 'Client 2 Update')`);

      // In SERIALIZABLE isolation, the conflict is often detected at COMMIT time
      await client1.query('COMMIT');
      await client2.query('COMMIT');
      
      // If we reach this line, both commits succeeded (which means isolation failed)
      console.log("❌ Test Failed: Both transactions succeeded (Isolation level might not be strict enough!)");
    } catch (err) {
      if (err.code === '40001') { // 40001 is the Postgres code for serialization_failure
        console.log(`✅ Test Passed! Caught expected Serialization Error:`);
        console.log(`   "${err.message}"`);
        console.log(`   (This proves our concurrency handling successfully prevents Lost Updates!)`);
      } else {
        console.log(`❌ Unexpected error: ${err.message}`);
      }
      await client1.query('ROLLBACK');
      await client2.query('ROLLBACK');
    } finally {
      client1.release();
      client2.release();
    }

    console.log("\n==================================================");
    console.log("Benchmark run complete.");
    console.log("==================================================");

  } catch (err) {
    console.error("Benchmark failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

runBenchmark();
