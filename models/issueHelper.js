const db = require('../config/db');

const { resolveCategory } = require('./categoryMatcher');

async function getAllCategories() {
  const [rows] = await db.execute(`
    SELECT
      c.category_id,
      c.category_name,
      c.department_id,
      d.department_name,
      c.description
    FROM categories c
    INNER JOIN departments d
      ON d.department_id = c.department_id
    ORDER BY d.department_name, c.category_name
  `);

  return rows;
}

async function getCategoryById(categoryId) {
  const [rows] = await db.execute(`
    SELECT
      c.category_id,
      c.category_name,
      c.department_id,
      d.department_name,
      c.description
    FROM categories c
    INNER JOIN departments d
      ON d.department_id = c.department_id
    WHERE c.category_id = ?
    LIMIT 1
  `, [categoryId]);

  return rows[0] || null;
}

async function createIssue(issue) {
  const [result] = await db.execute(`
    INSERT INTO issues
      (
        user_id,
        category_id,
        department_id,
        title,
        description,
        image_url,
        latitude,
        longitude,
        location_name,
        status,
        priority
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 0)
  `, [
    issue.userId,
    issue.categoryId,
    issue.departmentId,
    issue.title,
    issue.description,
    issue.imageUrl,
    issue.latitude,
    issue.longitude,
    issue.locationName
  ]);

  const conn = await db.getConnection();

  try {
    await conn.execute(`
      INSERT INTO issue_status_history
        (issue_id, old_status, new_status, changed_by, comment)
      VALUES (?, NULL, 'Pending', ?, 'Issue reported')
    `, [
      result.insertId,
      issue.userId
    ]);

  } finally {
    conn.release();
  }

  return result.insertId;
}

/* URBANEYE_CATEGORY_UPDATE_4 */

async function suggestCategoryFromText(text) {
  if (!String(text || '').trim()) {
    return null;
  }

  const categories = await getAllCategories();

  return resolveCategory(text, categories);
}

const issueSelect = `
  SELECT
    i.issue_id,
    i.user_id,
    u.full_name AS reporter_name,
    i.category_id,
    c.category_name,
    i.department_id,
    d.department_name,
    i.title,
    i.description,
    i.image_url,
    i.latitude,
    i.longitude,
    i.location_name,
    i.status,
    i.priority,
    i.ai_category,
    i.ai_confidence,
    i.created_at,
    i.updated_at,
    i.resolved_at,
    (
      SELECT COUNT(*)
      FROM votes v
      WHERE v.issue_id = i.issue_id
    ) AS vote_count
  FROM issues i
  JOIN users u
    ON u.user_id = i.user_id
  LEFT JOIN categories c
    ON c.category_id = i.category_id
  LEFT JOIN departments d
    ON d.department_id = i.department_id
`;

function scopeForUser(user, alias = 'i') {
  if (user.role === 'admin') {
    return {
      sql: '1=1',
      params: []
    };
  }

  if (user.role === 'officer') {
    return {
      sql: `${alias}.department_id = ?`,
      params: [user.department_id || -1]
    };
  }

  return {
    sql: `${alias}.user_id = ?`,
    params: [user.user_id]
  };
}

async function getIssuesForUser(user, filters = {}) {
  const scope = scopeForUser(user);

  const clauses = [scope.sql];

  const params = [...scope.params];

  if (
    filters.status &&
    ['Pending', 'In Progress', 'Resolved'].includes(filters.status)
  ) {
    clauses.push('i.status = ?');

    params.push(filters.status);
  }

  if (
    filters.category_id &&
    Number.isInteger(Number(filters.category_id))
  ) {
    clauses.push('i.category_id = ?');

    params.push(Number(filters.category_id));
  }

  if (filters.q) {
    clauses.push(`(
      i.title LIKE ?
      OR i.description LIKE ?
      OR i.location_name LIKE ?
      OR CAST(i.issue_id AS CHAR) LIKE ?
    )`);

    const q = `%${filters.q}%`;

    params.push(q, q, q, q);
  }

  const limit = Math.min(
    Math.max(Number(filters.limit) || 100, 1),
    200
  );

  const [rows] = await db.execute(`
    ${issueSelect}
    WHERE ${clauses.join(' AND ')}
    ORDER BY i.created_at DESC
    LIMIT ${limit}
  `, params);

  return rows;
}

async function getIssueForUser(issueId, user) {
  const scope = scopeForUser(user);

  const [rows] = await db.execute(`
    ${issueSelect}
    WHERE i.issue_id = ?
      AND ${scope.sql}
    LIMIT 1
  `, [
    issueId,
    ...scope.params
  ]);

  return rows[0] || null;
}

// ====================================================
// COMMUNITY FEED
// Show other citizens' unresolved reports.
// Include the logged-in citizen's vote state.
// ====================================================

async function getCommunityIssues(user, requestedLimit = 50) {
  const limit = Math.min(
    Math.max(Number(requestedLimit) || 50, 1),
    100
  );

  const [rows] = await db.execute(`
    SELECT
      i.issue_id,
      i.user_id,
      u.full_name AS reporter_name,
      i.category_id,
      c.category_name,
      i.department_id,
      d.department_name,
      i.title,
      i.description,
      i.image_url,
      i.latitude,
      i.longitude,
      i.location_name,
      i.status,
      i.created_at,

      (
        SELECT COUNT(*)
        FROM votes v
        WHERE v.issue_id = i.issue_id
      ) AS vote_count,

      EXISTS (
        SELECT 1
        FROM votes mine
        WHERE mine.issue_id = i.issue_id
          AND mine.user_id = ?
      ) AS voted_by_me

    FROM issues i

    INNER JOIN users u
      ON u.user_id = i.user_id

    LEFT JOIN categories c
      ON c.category_id = i.category_id

    LEFT JOIN departments d
      ON d.department_id = i.department_id

    WHERE u.role = 'citizen'
      AND i.user_id <> ?
      AND i.status IN ('Pending', 'In Progress')

    ORDER BY i.created_at DESC

    LIMIT ${limit}
  `, [
    user.user_id,
    user.user_id
  ]);

  return rows.map(row => ({
    ...row,
    vote_count: Number(row.vote_count || 0),
    voted_by_me: Boolean(row.voted_by_me),
    can_vote: !Boolean(row.voted_by_me)
  }));
}

// ====================================================
// COMMUNITY VOTING
// ====================================================

async function voteForIssue(issueId, userId) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [issues] = await conn.execute(`
      SELECT issue_id, user_id, status
      FROM issues
      WHERE issue_id = ?
      FOR UPDATE
    `, [issueId]);

    if (!issues.length) {
      await conn.rollback();

      return {
        notFound: true
      };
    }

    const issue = issues[0];

    if (Number(issue.user_id) === Number(userId)) {
      await conn.rollback();

      return {
        ownIssue: true
      };
    }

    if (!['Pending', 'In Progress'].includes(issue.status)) {
      await conn.rollback();

      return {
        closed: true
      };
    }

    await conn.execute(`
      INSERT INTO votes
        (issue_id, user_id)
      VALUES (?, ?)
    `, [
      issueId,
      userId
    ]);

    const [counts] = await conn.execute(`
      SELECT COUNT(*) AS vote_count
      FROM votes
      WHERE issue_id = ?
    `, [issueId]);

    await conn.commit();

    return {
      success: true,
      issue_id: Number(issueId),
      vote_count: Number(counts[0].vote_count || 0)
    };

  } catch (error) {
    await conn.rollback();

    throw error;

  } finally {
    conn.release();
  }
}

// ====================================================
// DASHBOARD STATISTICS
// ====================================================

async function getDashboardStats(user) {
  const scope = scopeForUser(user);

  const [rows] = await db.execute(`
    SELECT
      COUNT(*) AS total,
      SUM(i.status = 'Pending') AS pending,
      SUM(i.status = 'In Progress') AS in_progress,
      SUM(i.status = 'Resolved') AS resolved
    FROM issues i
    WHERE ${scope.sql}
  `, scope.params);

  const [categories] = await db.execute(`
    SELECT
      COALESCE(c.category_name, 'Uncategorised') AS category_name,
      COUNT(*) AS total
    FROM issues i
    LEFT JOIN categories c
      ON c.category_id = i.category_id
    WHERE ${scope.sql}
    GROUP BY c.category_id, c.category_name
    ORDER BY total DESC
  `, scope.params);

  const [monthly] = await db.execute(`
    SELECT
      DATE_FORMAT(i.created_at, '%Y-%m') AS month,
      COUNT(*) AS total
    FROM issues i
    WHERE ${scope.sql}
      AND i.created_at >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH)
    GROUP BY DATE_FORMAT(i.created_at, '%Y-%m')
    ORDER BY month
  `, scope.params);

  return {
    summary: {
      total: Number(rows[0].total || 0),
      pending: Number(rows[0].pending || 0),
      in_progress: Number(rows[0].in_progress || 0),
      resolved: Number(rows[0].resolved || 0)
    },

    categories,

    monthly
  };
}

// ====================================================
// MONTH 4 WEEK 1:
// STATUS UPDATE + ROLE-BASED NOTIFICATIONS
// ====================================================

async function updateIssueStatus(issueId, status, changedBy, comment) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Get the report and its assigned department.

    const [found] = await conn.execute(`
      SELECT
        issue_id,
        user_id,
        department_id,
        status
      FROM issues
      WHERE issue_id = ?
      FOR UPDATE
    `, [issueId]);

    if (!found.length) {
      await conn.rollback();

      return {
        notFound: true
      };
    }

    const issue = found[0];

    const old = issue.status;

    // Do not create duplicate history or notifications
    // when the status has not actually changed.

    if (old === status) {
      await conn.commit();

      return {
        unchanged: true,
        issue
      };
    }

    // Update the report status.

    await conn.execute(`
      UPDATE issues
      SET
        status = ?,
        resolved_at = CASE
          WHEN ? = 'Resolved' THEN CURRENT_TIMESTAMP
          ELSE NULL
        END
      WHERE issue_id = ?
    `, [
      status,
      status,
      issueId
    ]);

    // Record the status history.

    await conn.execute(`
      INSERT INTO issue_status_history
        (
          issue_id,
          old_status,
          new_status,
          changed_by,
          comment
        )
      VALUES (?, ?, ?, ?, ?)
    `, [
      issueId,
      old,
      status,
      changedBy,
      comment || null
    ]);

    // Find:
    // 1. The original reporter.
    // 2. All administrators.
    // 3. Officers assigned to this report's department.

    const [users] = await conn.execute(`
      SELECT user_id, role
      FROM users
      WHERE user_id = ?
         OR role = 'admin'
         OR (
           role = 'officer'
           AND department_id = ?
         )
    `, [
      issue.user_id,
      issue.department_id
    ]);

    const recipientMap = new Map();

    for (const user of users) {
      const userId = Number(user.user_id);

      // Do not notify the person who performed the update.

      if (userId === Number(changedBy)) {
        continue;
      }

      let title;
      let message;

      // Original report owner.

      if (userId === Number(issue.user_id)) {
        title = `Issue #${issueId} status updated`;

        message =
          `Your report status changed from ${old} to ${status}.` +
          (comment ? ` Officer comment: ${comment}` : '');
      }

      // Administrators receive system-wide oversight updates.

      else if (user.role === 'admin') {
        title = `Report #${issueId} status updated`;

        message =
          `Report #${issueId} status changed from ${old} to ${status}.`;
      }

      // Officers receive updates for their own department.

      else if (user.role === 'officer') {
        title = `Department report #${issueId} updated`;

        message =
          `A report assigned to your department changed from ${old} to ${status}.`;
      }

      else {
        continue;
      }

      recipientMap.set(userId, {
        userId,
        title,
        message
      });
    }

    const recipients = [...recipientMap.values()];

    // Insert all notifications within the same transaction
    // as the status update and history record.

    if (recipients.length) {
      const placeholders = recipients
        .map(() => "(?, ?, ?, ?, 'status_update')")
        .join(', ');

      const values = recipients.flatMap(item => [
        item.userId,
        issueId,
        item.title,
        item.message
      ]);

      await conn.execute(`
        INSERT INTO notifications
          (
            user_id,
            issue_id,
            title,
            message,
            notification_type
          )
        VALUES ${placeholders}
      `, values);
    }

    await conn.commit();

    return {
      issue: {
        issue_id: Number(issueId),
        status
      }
    };

  } catch (error) {
    await conn.rollback();

    throw error;

  } finally {
    conn.release();
  }
}

// ====================================================
// EXPORT FUNCTIONS
// ====================================================

module.exports = {
  getAllCategories,
  getCategoryById,
  suggestCategoryFromText,
  createIssue,
  getIssuesForUser,
  getIssueForUser,
  getCommunityIssues,
  voteForIssue,
  getDashboardStats,
  updateIssueStatus
};