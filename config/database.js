const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ivr_pivot_myflot',
    charset: 'utf8mb4',
    timezone: '+00:00',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function testConnection() {
    const connection = await pool.getConnection();
    connection.release();
}

async function incrementCallerAttempt(phoneNumber, callDate) {
    const [result] = await pool.execute(
        `INSERT INTO caller_frequency_tracking
            (phone_number, call_date, attempt_count)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE
            attempt_count = LAST_INSERT_ID(attempt_count + 1),
            last_attempt_at = CURRENT_TIMESTAMP`,
        [phoneNumber, callDate]
    );

    // A fresh INSERT affects one row and is always attempt #1. For a duplicate
    // row, LAST_INSERT_ID contains the atomically incremented attempt count.
    return result.affectedRows === 1 ? 1 : result.insertId;
}

async function markCallerDiverted(phoneNumber, callDate) {
    await pool.execute(
        `UPDATE caller_frequency_tracking
         SET diverted_to_campaign = 1
         WHERE phone_number = ? AND call_date = ?`,
        [phoneNumber, callDate]
    );
}

async function deleteAttemptsForDate(callDate) {
    const [result] = await pool.execute(
        `DELETE FROM caller_frequency_tracking WHERE call_date = ?`,
        [callDate]
    );

    return result.affectedRows;
}

module.exports = {
    testConnection,
    incrementCallerAttempt,
    markCallerDiverted,
    deleteAttemptsForDate
};
