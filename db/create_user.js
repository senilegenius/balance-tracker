// Script to create a user with hashed password
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const readline = require('readline');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function createUser() {
  try {
    console.log('\n🔐 Create User\n');

    const username = await question('Enter username: ');
    const password = await question('Enter password: ');

    // Hash the password (10 rounds)
    console.log('\n⏳ Hashing password...');
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user into database
    await pool.query(`
      INSERT INTO users (username, password_hash)
      VALUES ($1, $2)
      ON CONFLICT (username)
      DO UPDATE SET password_hash = $2
    `, [username, passwordHash]);

    console.log(`\n✅ User "${username}" created successfully!`);
    console.log('You can now login with this username and password.\n');

    rl.close();
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error creating user:', error);
    rl.close();
    await pool.end();
    process.exit(1);
  }
}

createUser();
