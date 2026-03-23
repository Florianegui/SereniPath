/**
 * Crée la table safe_places. Usage: cd server && node scripts/create-safe-places.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'zenova',
  });
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS safe_places (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        place_type VARCHAR(50) DEFAULT 'other',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user (user_id)
      )
    `);
    console.log('✅ Table safe_places créée ou déjà existante.');
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
