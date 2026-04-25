const fs = require('fs');
const { Client } = require('pg');

async function initializeDatabase() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        console.error("❌ ERROR: DATABASE_URL environment variable is missing.");
        process.exit(1);
    }

    console.log("🔌 Connecting to the database...");
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log("✅ Connected successfully!");

        console.log(" خ Reading schema.sql...");
        const schema = fs.readFileSync('./schema.sql', 'utf8');

        console.log("⚙️ Executing schema.sql on cloud database...");
        await client.query(schema);

        console.log("🎉 Database initialized successfully!");
    } catch (err) {
        console.error("❌ Error initializing database:", err);
    } finally {
        await client.end();
        process.exit(0);
    }
}

initializeDatabase();
