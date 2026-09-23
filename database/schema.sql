CREATE DATABASE IF NOT EXISTS ivr_pivot_myflot
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE ivr_pivot_myflot;

CREATE TABLE IF NOT EXISTS caller_frequency_tracking (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    call_date DATE NOT NULL,
    attempt_count INT NOT NULL DEFAULT 1,
    diverted_to_campaign TINYINT(1) NOT NULL DEFAULT 0,
    first_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_phone_per_day (phone_number, call_date),
    INDEX idx_phone_number (phone_number),
    INDEX idx_call_date (call_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
