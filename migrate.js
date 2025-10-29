// migrate.js
// Usage: set DATABASE_URL then: node migrate.js
// Example (PowerShell):
// $env:DATABASE_URL="postgres://user:pass@host:5432/dbname?sslmode=require"
// node migrate.js

const { Client } = require('pg');

const sql = `-- paste the SQL from migrations/init.sql here or require the file instead
-- For readability, we will include the SQL in a template literal.
-- (If you prefer a separate file, read migrations/init.sql.)
`;

// If you prefer to read from file, uncomment below:
// const fs = require('fs');
// const sql = fs.readFileSync('./migrations/init.sql', 'utf8');

async function run() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('Missing DATABASE_URL env. Get it from Supabase -> Settings -> Database -> Connection string');
    process.exit(1);
  }

  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false } // needed for many hosted PG (like Supabase) when using NODE
  });

  try {
    await client.connect();
    console.log('Connected to DB — running migration...');
    // if you used the sql const above blank, read file instead
    const fs = require('fs');
    let content;
    const path = './migrations/init.sql';
    if (fs.existsSync(path)) {
      content = fs.readFileSync(path, 'utf8');
    } else {
      console.error('migrations/init.sql not found. Please create the file with SQL and re-run.');
      process.exit(1);
    }

    // split by semicolon and run sequentially to allow easier error messages
    const statements = content.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
    for (const st of statements) {
      try {
        await client.query(st);
      } catch (err) {
        // ignore "already exists" style errors are handled by IF NOT EXISTS in SQL
        console.error('Error running statement (continuing):', err.message);
      }
    }

    console.log('Migration done.');
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    try { await client.end(); } catch (_) {}
    process.exit(1);
  }
}

run();
