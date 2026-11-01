const db = require('../config/db');


// ======================================================
// FIND USER BY EMAIL
// ======================================================

async function findUserByEmail(email) {

    const [rows] = await db.execute(

        `SELECT
            user_id,
            full_name,
            email,
            password_hash,
            role,
            department_id,
            created_at
         FROM users
         WHERE email = ?
         LIMIT 1`,

        [email]

    );

    return rows[0] || null;
}


// ======================================================
// FIND USER BY ID
// ======================================================

async function findUserById(userId) {

    const [rows] = await db.execute(

        `SELECT
            user_id,
            full_name,
            email,
            role,
            department_id,
            created_at
         FROM users
         WHERE user_id = ?
         LIMIT 1`,

        [userId]

    );

    return rows[0] || null;
}


// ======================================================
// CREATE USER
// ======================================================

async function createUser(
    fullName,
    email,
    passwordHash,
    role,
    departmentId
) {

    const [result] = await db.execute(

        `INSERT INTO users
        (
            full_name,
            email,
            password_hash,
            role,
            department_id
        )
        VALUES (?, ?, ?, ?, ?)`,

        [
            fullName,
            email,
            passwordHash,
            role,
            departmentId
        ]

    );

    return result.insertId;
}


// ======================================================
// GET DEPARTMENT
// ======================================================

async function getDepartmentById(departmentId) {

    const [rows] = await db.execute(

        `SELECT
            department_id,
            department_name
         FROM departments
         WHERE department_id = ?
         LIMIT 1`,

        [departmentId]

    );

    return rows[0] || null;
}


module.exports = {

    findUserByEmail,

    findUserById,

    createUser,

    getDepartmentById

};