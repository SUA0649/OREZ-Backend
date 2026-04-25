// backend/api_benchmark.js
const http = require('http');

const REPO_ID = 17; // Assuming repo 17 exists based on previous logs
const API_URL = `http://localhost:3001/api/repos/${REPO_ID}/files`;
const ITERATIONS = 10000;

// Helper to make an HTTP request
const makeRequest = () => {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    http.get(API_URL, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          duration: Date.now() - start
        });
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
};

const runBenchmark = async () => {
  console.log("==================================================");
  console.log("             OREZ API LOAD TEST              ");
  console.log("==================================================\n");

  console.log("Testing endpoint:", API_URL);
  console.log("Iterations:", ITERATIONS);
  console.log("\n");

  try {
    // --------------------------------------------------
    // METRIC 1: Sequential Latency Test
    // --------------------------------------------------
    console.log("📊 METRIC 1: SEQUENTIAL LATENCY TEST");
    console.log("--------------------------------------------------");
    let totalTimeSequential = 0;

    // Warmup request to ensure DB/Cache is ready
    await makeRequest();

    for (let i = 0; i < ITERATIONS; i++) {
      const { duration, statusCode } = await makeRequest();
      if (statusCode !== 200) {
        throw new Error(`Request failed with status ${statusCode}. Make sure repo ID ${REPO_ID} exists.`);
      }
      totalTimeSequential += duration;
    }

    const avgLatency = (totalTimeSequential / ITERATIONS).toFixed(2);
    console.log(`- ${ITERATIONS} sequential requests completed.`);
    console.log(`- Average Response Time: ${avgLatency} ms per request\n`);


    // --------------------------------------------------
    // METRIC 2: Concurrent Spike Test
    // --------------------------------------------------
    console.log("⚡ METRIC 2: CONCURRENT SPIKE TEST (100 Users)");
    console.log("--------------------------------------------------");

    const promises = [];
    const concStart = Date.now();

    for (let i = 0; i < ITERATIONS; i++) {
      promises.push(makeRequest());
    }

    await Promise.all(promises);
    const concEnd = Date.now();
    const concTotalTime = concEnd - concStart;

    console.log(`- ${ITERATIONS} simultaneous requests handled in: ${concTotalTime} ms`);
    console.log(`- API Throughput: ${((ITERATIONS / concTotalTime) * 1000).toFixed(2)} requests/sec\n`);

    console.log("==================================================");
    console.log("Benchmark run complete.");
    console.log("==================================================");
    console.log("TIP: To see the impact of Redis, comment out the Redis code in routes.js, restart the server, and run this script again!");

  } catch (err) {
    console.error("❌ Benchmark failed:", err.message);
    console.log("Make sure your Node.js server (npm start) is currently running!");
  }
};

runBenchmark();
