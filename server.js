const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const issueRoutes = require('./routes/issueRoutes');
const aiRoutes = require('./routes/aiRoutes');

const app = express();

const PORT = process.env.PORT || 5000;


// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());

app.use(express.json({ limit: '1mb' }));

app.use(express.urlencoded({
    extended: true
}));


// ======================================================
// SERVE FRONTEND PAGES
// ======================================================

app.use(express.static(path.join(__dirname, 'public')));


// ======================================================
// STATIC UPLOADS
// ======================================================

app.use(
    '/uploads',
    express.static(path.join(__dirname, 'uploads'))
);


// ======================================================
// HOME
// ======================================================

app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'public', 'login.html')
    );
});


// ======================================================
// API TEST
// ======================================================

app.get('/api', (req, res) => {
    res.json({
        success: true,
        message: '🚀 UrbanEye Botswana API Running',
        version: '1.0.0',
        week: 'Month 1 - Weeks 1 to 4: Foundation, authentication, reporting and dashboard'
    });
});


// ======================================================
// DATABASE TEST
// ======================================================

app.get('/api/db-test', async (req, res) => {

    try {

        const [rows] = await db.query(
            'SELECT 1 AS database_test'
        );

        res.json({
            success: true,
            message: 'MySQL database connection is working.',
            result: rows
        });

    } catch (error) {

        console.error('Database test error:', error);

        res.status(500).json({
            success: false,
            message: 'Database connection failed.',
            error: error.message
        });
    }
});


// ======================================================
// AUTHENTICATION ROUTES
// ======================================================

app.use(
    '/api/auth',
    authRoutes
);

app.use(
    '/api/ai', 
    aiRoutes
);


// ======================================================
// ISSUE REPORTING + DASHBOARD API (Month 1 Weeks 3-4)
// ======================================================
app.use('/api/issues', issueRoutes);

// ======================================================
// 404 HANDLER
// ======================================================

app.use((req, res) => {

    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.originalUrl} not found.`
    });

});


// ======================================================
// START SERVER
// ======================================================

app.listen(PORT, () => {

    console.log('');
    console.log('==============================================');
    console.log('🚀 UrbanEye Botswana API Running');
    console.log('==============================================');
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🔐 Auth:   http://localhost:${PORT}/api/auth`);
    console.log(`📝 Login:  http://localhost:${PORT}/login.html`);
    console.log(`📝 Register: http://localhost:${PORT}/register.html`);
    console.log(`🗄️ DB:     ${process.env.DB_NAME}`);
    console.log('==============================================');
    console.log('');

});
