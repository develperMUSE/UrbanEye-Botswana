
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const authenticateToken = require('../middleware/authMiddleware');
const { allowRoles } = authenticateToken;

const {
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
} = require('../models/issueHelper');

const db = require('../config/db');
const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    cb(
      null,
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).toLowerCase()}`
    );
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Upload a JPG, PNG, WEBP or GIF image.'));
    }

    cb(null, true);
  }
});

const statuses = ['Pending', 'In Progress', 'Resolved'];

// ====================================================
// MONTH 4 WEEK 1: IN-APP NOTIFICATION SYSTEM
// ====================================================

// GET ALL NOTIFICATIONS FOR LOGGED-IN USER
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const [notifications] = await db.execute(`
      SELECT notification_id, issue_id, title, message,
             notification_type, is_read, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC, notification_id DESC
      LIMIT 50
    `, [req.user.user_id]);

    const [counts] = await db.execute(`
      SELECT COUNT(*) AS unread_count
      FROM notifications
      WHERE user_id = ? AND is_read = 0
    `, [req.user.user_id]);

    res.json({
      success: true,
      notifications,
      unread_count: Number(counts[0].unread_count || 0)
    });
  } catch (error) {
    console.error('Notifications load error:', error);
    res.status(500).json({
      success: false,
      message: 'Could not load notifications.'
    });
  }
});

// MARK ONE NOTIFICATION AS READ
router.patch('/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID.'
      });
    }

    const [result] = await db.execute(`
      UPDATE notifications
      SET is_read = 1
      WHERE notification_id = ? AND user_id = ?
    `, [id, req.user.user_id]);

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found.'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read.'
    });
  } catch (error) {
    console.error('Notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Could not update notification.'
    });
  }
});

// MARK ALL NOTIFICATIONS AS READ
router.patch('/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await db.execute(`
      UPDATE notifications
      SET is_read = 1
      WHERE user_id = ? AND is_read = 0
    `, [req.user.user_id]);

    res.json({
      success: true,
      message: 'All notifications marked as read.'
    });
  } catch (error) {
    console.error('Notification read-all error:', error);
    res.status(500).json({
      success: false,
      message: 'Could not update notifications.'
    });
  }
});

// ====================================================
// GET CATEGORIES
// ====================================================

router.get('/categories', authenticateToken, async (_req, res) => {
  try {
    res.json({
      success: true,
      categories: await getAllCategories()
    });
  } catch (error) {
    console.error('Load categories error:', error);

    res.status(500).json({
      success: false,
      message: 'Could not load categories.'
    });
  }
});

// ====================================================
// MONTH 3 WEEK 3: COMMUNITY REPORTS FEED
// ====================================================

router.get(
  '/community',
  authenticateToken,
  allowRoles('citizen'),
  async (req, res) => {
    try {
      const issues = await getCommunityIssues(
        req.user,
        req.query.limit
      );

      res.json({
        success: true,
        issues
      });
    } catch (error) {
      console.error('Community feed error:', error);

      res.status(500).json({
        success: false,
        message: 'Could not load community reports.'
      });
    }
  }
);

// ====================================================
// MONTH 3 WEEK 3: COMMUNITY VOTING
// ====================================================

router.post(
  '/:id/vote',
  authenticateToken,
  allowRoles('citizen'),
  async (req, res) => {
    try {
      const issueId = Number(req.params.id);

      if (!Number.isInteger(issueId) || issueId < 1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid issue ID.'
        });
      }

      const result = await voteForIssue(
        issueId,
        req.user.user_id
      );

      if (result.notFound) {
        return res.status(404).json({
          success: false,
          message: 'Community report not found.'
        });
      }

      if (result.ownIssue) {
        return res.status(403).json({
          success: false,
          message: 'You cannot vote for your own report.'
        });
      }

      if (result.closed) {
        return res.status(400).json({
          success: false,
          message: 'This report is no longer open for community voting.'
        });
      }

      res.json({
        success: true,
        message: 'Your community vote was recorded.',
        issue_id: result.issue_id,
        vote_count: result.vote_count
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: 'You have already voted for this report.'
        });
      }

      console.error('Community vote error:', error);

      res.status(500).json({
        success: false,
        message: 'Could not record your vote. Please try again.'
      });
    }
  }
);

// ====================================================
// CREATE A REPORT
// ====================================================

router.post(
  '/',
  authenticateToken,
  allowRoles('citizen', 'admin', 'officer'),
  (req, res, next) => {
    upload.single('image')(req, res, error => {
      if (error) {
        return res.status(400).json({
          success: false,
          message:
            error.code === 'LIMIT_FILE_SIZE'
              ? 'Image must be 5 MB or smaller.'
              : error.message
        });
      }

      next();
    });
  },
  async (req, res) => {
    let savedPath;

    try {
      const title = String(req.body.title || '').trim();
      const description = String(req.body.description || '').trim();
      const locationName =
        String(req.body.location_name || '').trim() || null;

      let categoryId = Number(req.body.category_id);
      let category = null;

      if (title.length < 4 || title.length > 200) {
        if (req.file) {
          fs.promises.unlink(req.file.path).catch(() => {});
        }

        return res.status(400).json({
          success: false,
          message: 'Title must be between 4 and 200 characters.'
        });
      }

      if (description.length < 10 || description.length > 5000) {
        if (req.file) {
          fs.promises.unlink(req.file.path).catch(() => {});
        }

        return res.status(400).json({
          success: false,
          message: 'Description must be between 10 and 5000 characters.'
        });
      }

      if (Number.isInteger(categoryId) && categoryId > 0) {
        category = await getCategoryById(categoryId);
      }

      let categorySource = 'manual';

      if (!category) {
        category = await suggestCategoryFromText(
          `${title} ${description}`
        );

        if (category) {
          categoryId = Number(category.category_id);
          categorySource = 'automatic';
        }
      }

      if (!category) {
        if (req.file) {
          fs.promises.unlink(req.file.path).catch(() => {});
        }

        return res.status(400).json({
          success: false,
          message:
            'Please select a category or describe the issue more clearly so it can be categorised automatically.'
        });
      }

      const parseCoordinate = (value, min, max) => {
        if (value === undefined || value === '') {
          return null;
        }

        const number = Number(value);

        return Number.isFinite(number) &&
          number >= min &&
          number <= max
          ? number
          : NaN;
      };

      const latitude = parseCoordinate(
        req.body.latitude,
        -90,
        90
      );

      const longitude = parseCoordinate(
        req.body.longitude,
        -180,
        180
      );

      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        if (req.file) {
          fs.promises.unlink(req.file.path).catch(() => {});
        }

        return res.status(400).json({
          success: false,
          message: 'Latitude or longitude is invalid.'
        });
      }

      const imageUrl = req.file
        ? `/uploads/${req.file.filename}`
        : null;

      if (req.file) {
        savedPath = req.file.path;
      }

      const issueId = await createIssue({
        userId: req.user.user_id,
        categoryId,
        departmentId: category.department_id,
        title,
        description,
        imageUrl,
        latitude,
        longitude,
        locationName
      });

      await db.execute(`
        INSERT INTO notifications
          (user_id, issue_id, title, message, notification_type)
        VALUES (?, ?, ?, ?, 'new_issue')
      `, [
        req.user.user_id,
        issueId,
        `Issue #${issueId} submitted`,
        'Your report was submitted successfully and is pending review.'
      ]);

      res.status(201).json({
        success: true,
        message: 'Issue submitted successfully.',
        issue_id: issueId,
        category_name: category.category_name,
        department_name: category.department_name,
        category_source: categorySource,
        status: 'Pending'
      });
    } catch (error) {
      if (savedPath) {
        fs.promises.unlink(savedPath).catch(() => {});
      }

      console.error('Create issue error:', error);

      res.status(500).json({
        success: false,
        message: 'Could not submit your report. Please try again.'
      });
    }
  }
);

// ====================================================
// LIST REPORTS VISIBLE TO LOGGED-IN USER
// ====================================================

router.get('/', authenticateToken, async (req, res) => {
  try {
    const issues = await getIssuesForUser(req.user, {
      status: req.query.status,
      category_id: req.query.category_id,
      q: String(req.query.q || '').trim(),
      limit: req.query.limit
    });

    res.json({
      success: true,
      issues
    });
  } catch (error) {
    console.error('Load reports error:', error);

    res.status(500).json({
      success: false,
      message: 'Could not load reports.'
    });
  }
});

// ====================================================
// DASHBOARD DATA
// ====================================================

router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const [stats, issues] = await Promise.all([
      getDashboardStats(req.user),
      getIssuesForUser(req.user, { limit: 8 })
    ]);

    res.json({
      success: true,
      ...stats,
      recent_issues: issues
    });
  } catch (error) {
    console.error('Dashboard error:', error);

    res.status(500).json({
      success: false,
      message: 'Could not load dashboard data.'
    });
  }
});

// ====================================================
// MONTH 4 WEEK 1: STATUS HISTORY TIMELINE API
// ====================================================

router.get('/:id/history', authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID.'
      });
    }

    const issue = await getIssueForUser(id, req.user);

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Report not found.'
      });
    }

    const [history] = await db.execute(`
      SELECT h.history_id, h.old_status, h.new_status,
             h.comment, h.changed_at,
             u.full_name AS changed_by_name
      FROM issue_status_history h
      LEFT JOIN users u ON u.user_id = h.changed_by
      WHERE h.issue_id = ?
      ORDER BY h.changed_at DESC
    `, [id]);

    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('Issue history error:', error);

    res.status(500).json({
      success: false,
      message: 'Could not load report history.'
    });
  }
});

// ====================================================
// UPDATE STATUS - OFFICER AND ADMIN ONLY
// ====================================================

router.patch(
  '/:id/status',
  authenticateToken,
  allowRoles('officer', 'admin'),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = String(req.body.status || '');
      const comment = String(req.body.comment || '')
        .trim()
        .slice(0, 1000);

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid issue ID.'
        });
      }

      if (!statuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Choose a valid status.'
        });
      }

      const visible = await getIssueForUser(id, req.user);

      if (!visible) {
        return res.status(404).json({
          success: false,
          message: 'Report not found in your permitted area.'
        });
      }

      const result = await updateIssueStatus(
        id,
        status,
        req.user.user_id,
        comment
      );

      if (result.notFound) {
        return res.status(404).json({
          success: false,
          message: 'Report not found.'
        });
      }

      res.json({
        success: true,
        message: result.unchanged
          ? 'Report already has that status.'
          : 'Report status updated.',
        issue: result.issue
      });
    } catch (error) {
      console.error('Update issue status error:', error);

      res.status(500).json({
        success: false,
        message: 'Could not update report status.'
      });
    }
  }
);

// ====================================================
// GET ONE REPORT
// ====================================================

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID.'
      });
    }

    const issue = await getIssueForUser(id, req.user);

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Report not found.'
      });
    }

    res.json({
      success: true,
      issue
    });
  } catch (error) {
    console.error('Load single report error:', error);

    res.status(500).json({
      success: false,
      message: 'Could not load report.'
    });
  }
});

module.exports = router;
