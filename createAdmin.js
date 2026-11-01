const bcrypt = require('bcryptjs');
const db = require('./config/db');

async function createAdmin() {
  const fullName = process.env.ADMIN_FULL_NAME;
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!fullName || !email || !password || password.length < 12) {
    console.error('Set ADMIN_FULL_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in your local .env before running this script.');
    process.exitCode = 1;
    await db.end();
    return;
  }
  try {
    const [existing] = await db.execute('SELECT user_id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) { console.log('An account with this email already exists. No changes made.'); return; }
    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.execute(`INSERT INTO users (full_name,email,password_hash,role,department_id) VALUES (?,?,?,'admin',NULL)`, [fullName,email,hash]);
    console.log(`Admin account created (user ID ${result.insertId}, email ${email}).`);
  } catch (error) { console.error('Could not create admin account:', error.message); process.exitCode = 1; }
  finally { await db.end(); }
}
createAdmin();
