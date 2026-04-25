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
