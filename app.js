// backend/app.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');

//Import routes
const apiRoutes = require('./routes');

const app = express();

// Middleware
app.use(compression()); // Compress all HTTP responses (Gzip)
app.use(cors({ origin: 'http://localhost:3000' })); // Allow frontend
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Optional: parse URL-encoded bodies

// --- Custom Request/Error Logger ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const isError = res.statusCode >= 400;
    
    // Formatting for terminal readability
    const statusColor = isError ? '\x1b[31m' : '\x1b[32m'; // Red for errors, Green for success
    const resetColor = '\x1b[0m';
    
    const message = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${statusColor}${res.statusCode}${resetColor} (${duration}ms)`;
    
    if (isError) {
      console.error(`❌ ERROR: ${message}`);
    } else {
      console.log(`✅ OK: ${message}`);
    }
  });
  next();
});
// -----------------------------------

// Mount the routes from routes.js
// All routes in routes.js will now be prefixed with /api
app.use('/api', apiRoutes);

// Optional: Serve static files (if you have any blobs or frontend assets)
app.use('/blobs', express.static(path.join(__dirname, 'blobs')));

// Start server
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
