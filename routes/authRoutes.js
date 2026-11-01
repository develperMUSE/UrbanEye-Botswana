const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const {
    findUserByEmail,
    findUserById,
    createUser,
    getDepartmentById
} = require('../models/dbHelper');

const authenticateToken = require('../middleware/authMiddleware');

const router = express.Router();


// ======================================================
// REGISTER
// Public registration is allowed for:
// - citizen
// - officer
//
// Admin accounts are created separately.
// ======================================================
router.post('/register', async (req, res) => {
    try {
        let {
            full_name,
            email,
            password,
            role,
            department_id
        } = req.body;

        // Clean input
        full_name = String(full_name || '').trim();
        email = String(email || '').trim().toLowerCase();
        password = String(password || '').trim();
        role = String(role || '').trim().toLowerCase();

        // Required fields
        if (!full_name || !email || !password || !role) {
            return res.status(400).json({
                success: false,
                message: 'Full name, email, password and role are required.'
            });
        }

        // Name validation
        if (full_name.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Full name must contain at least 2 characters.'
            });
        }

        // Email validation
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address.'
            });
        }

        // Password validation
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least 8 characters.'
            });
        }

        // ==================================================
        // IMPORTANT:
        // Admin cannot register publicly.
        // ==================================================
        if (role !== 'citizen' && role !== 'officer') {
            return res.status(403).json({
                success: false,
                message: 'Only Citizen and Officer accounts can be registered publicly.'
            });
        }

        // Check duplicate email
        const existingUser = await findUserByEmail(email);

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists.'
            });
        }

        // ==================================================
        // CITIZEN
        // Citizens do not belong to a department.
        // ==================================================
        if (role === 'citizen') {
            department_id = null;
        }

        // ==================================================
        // OFFICER
        // Officers must belong to a valid department.
        // ==================================================
        if (role === 'officer') {
            if (!department_id) {
                return res.status(400).json({
                    success: false,
                    message: 'Department is required for officer accounts.'
                });
            }

            const department = await getDepartmentById(department_id);

            if (!department) {
                return res.status(400).json({
                    success: false,
                    message: 'The selected department does not exist.'
                });
            }
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const userId = await createUser(
            full_name,
            email,
            passwordHash,
            role,
            department_id
        );

        // Get newly created user
        const newUser = await findUserById(userId);

        return res.status(201).json({
            success: true,
            message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully.`,
            user: newUser
        });

    } catch (error) {
        console.error('Registration error:', error);

        return res.status(500).json({
            success: false,
            message: 'Registration failed.',
            error: error.message
        });
    }
});


// ======================================================
// LOGIN
// Supports ALL THREE ROLES:
// - admin
// - officer
// - citizen
// ======================================================
router.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;

        email = String(email || '').trim().toLowerCase();
        password = String(password || '');

        // Required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        // Find user
        const user = await findUserByEmail(email);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        // Check password
        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        // Create JWT
        const token = jwt.sign(
            {
                user_id: user.user_id,
                role: user.role,
                department_id: user.department_id
            },
            process.env.JWT_SECRET,
            {
                expiresIn: process.env.JWT_EXPIRES_IN || '24h'
            }
        );

        // Never send password hash to browser
        delete user.password_hash;

        return res.status(200).json({
            success: true,
            message: 'Login successful.',
            token,
            user
        });

    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            success: false,
            message: 'Login failed.',
            error: error.message
        });
    }
});


// ======================================================
// CURRENT USER
// ======================================================
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await findUserById(req.user.user_id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User account not found.'
            });
        }

        return res.status(200).json({
            success: true,
            user
        });

    } catch (error) {
        console.error('Get current user error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to retrieve user information.'
        });
    }
});


// ======================================================
// AUTH TEST
// ======================================================
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'UrbanEye authentication routes are working.',
        supported_roles: [
            'admin',
            'officer',
            'citizen'
        ]
    });
});


module.exports = router;