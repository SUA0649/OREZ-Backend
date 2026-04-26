// backend/cloud_benchmark.js

const REPO_ID = 1; // Assuming repo 17 exists based on previous logs
const API_URL = `https://orez-backend.onrender.com/api/repos/${REPO_ID}/files`;
const ITERATIONS = 1000; // Reduced iterations to 1000 for cloud stress testing to avoid timeouts

// Helper to make an HTTP/HTTPS request using native fetch
const makeRequest = async () => {
  const start = Date.now();
  try {
    const res = await fetch(API_URL);
    // read the full body to ensure the request is actually complete
    await res.text();
    return {
      statusCode: res.status,
      duration: Date.now() - start
    };
  } catch (err) {
    throw err;
  }
};

const runBenchmark = async () => {
  console.log("==================================================");
  console.log("          OREZ CLOUD API LOAD TEST              ");
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
    console.log("⚡ METRIC 2: CONCURRENT SPIKE TEST (1000 Users)");
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
    console.log("            TEST COMPLETED SAFELY                 ");
    console.log("==================================================");

  } catch (err) {
    console.error("❌ Cloud Benchmark failed:", err.message);
    console.log("If you see 'fetch failed' or '502 Bad Gateway', the free tier server might be temporarily overwhelmed!");
  }
};

runBenchmark();
