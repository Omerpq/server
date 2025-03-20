const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false // Set to true if your database requires SSL
});

module.exports = pool;
