
require('dotenv').config();

const db = require('./config/db');

async function main() {
  try {
    const [tables] = await db.query(
      "SHOW TABLES LIKE 'issue_status_history'"
    );

    if (!tables.length) {
      console.log('History table does not exist.');
      return;
    }

    console.log('History table exists.');

    const [rows] = await db.query(`
      SELECT
        h.history_id,
        h.issue_id,
        h.old_status,
        h.new_status,
        u.full_name AS changed_by,
        h.comment,
        h.changed_at
      FROM issue_status_history h
      LEFT JOIN users u
        ON u.user_id = h.changed_by
      ORDER BY h.changed_at DESC, h.history_id DESC
      LIMIT 20
    `);

    console.table(rows);

    if (!rows.length) {
      console.log('No history records found yet.');
    }

  } catch (error) {
    console.error('Check failed:', error.message);
  } finally {
    await db.end();
  }
}

main();
