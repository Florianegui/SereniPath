const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'serenipathh',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const initialize = async () => {
  try {
    // Test connection
    const connection = await pool.getConnection();
    console.log('✅ Database connected');
    connection.release();

    // Create tables if they don't exist
    await createTables();
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
};

const createTables = async () => {
  const queries = [
    // Users table
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    
    // Zones table
    `CREATE TABLE IF NOT EXISTS zones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      latitude DECIMAL(10, 8) NOT NULL,
      longitude DECIMAL(11, 8) NOT NULL,
      radius INT DEFAULT 500,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Density data table
    `CREATE TABLE IF NOT EXISTS density_data (
      id INT AUTO_INCREMENT PRIMARY KEY,
      zone_id INT NOT NULL,
      hour INT NOT NULL,
      day_of_week INT NOT NULL,
      density_score DECIMAL(5, 2) NOT NULL,
      data_source VARCHAR(100),
      reliability_score DECIMAL(3, 2) DEFAULT 0.8,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
      UNIQUE KEY unique_zone_hour_day (zone_id, hour, day_of_week),
      INDEX idx_zone_hour_day (zone_id, hour, day_of_week)
    )`,
    
    // Routes table
    `CREATE TABLE IF NOT EXISTS routes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      start_lat DECIMAL(10, 8) NOT NULL,
      start_lng DECIMAL(11, 8) NOT NULL,
      end_lat DECIMAL(10, 8) NOT NULL,
      end_lng DECIMAL(11, 8) NOT NULL,
      recommended_path JSON,
      density_score DECIMAL(5, 2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    
    // User preferences table
    `CREATE TABLE IF NOT EXISTS user_preferences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      max_density_score DECIMAL(5, 2) DEFAULT 50.0,
      preferred_hours JSON,
      avoid_areas JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user (user_id)
    )`,
    // Mood tracker: une entrée par jour par utilisateur (comment il s'est senti lors de sa sortie)
    `CREATE TABLE IF NOT EXISTS mood_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      entry_date DATE NOT NULL,
      mood VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_date (user_id, entry_date),
      INDEX idx_user_month (user_id, entry_date)
    )`
  ];

  for (const query of queries) {
    try {
      await pool.execute(query);
    } catch (error) {
      console.error('Error creating table:', error.message);
    }
  }

  // Insert sample zones if none exist
  const [zones] = await pool.execute('SELECT COUNT(*) as count FROM zones');
  if (zones[0].count === 0) {
    await insertSampleZones();
  }
};

const insertSampleZones = async () => {
  // Sample zones for Paris (you can modify coordinates)
  const sampleZones = [
    { name: 'Centre-ville', lat: 48.8566, lng: 2.3522, radius: 1000 },
    { name: 'Gare du Nord', lat: 48.8809, lng: 2.3553, radius: 800 },
    { name: 'Châtelet', lat: 48.8584, lng: 2.3470, radius: 600 },
    { name: 'Montmartre', lat: 48.8867, lng: 2.3431, radius: 700 },
    { name: 'Bastille', lat: 48.8532, lng: 2.3697, radius: 500 }
  ];

  for (const zone of sampleZones) {
    await pool.execute(
      'INSERT INTO zones (name, latitude, longitude, radius) VALUES (?, ?, ?, ?)',
      [zone.name, zone.lat, zone.lng, zone.radius]
    );
  }

  // Insert sample density data
  const [zonesData] = await pool.execute('SELECT id FROM zones');
  for (const zone of zonesData) {
    for (let hour = 0; hour < 24; hour++) {
      for (let day = 0; day < 7; day++) {
        // Simulate density: higher during rush hours (8-9, 17-18) and weekdays
        let density = 30 + Math.random() * 40;
        if ((hour >= 8 && hour <= 9) || (hour >= 17 && hour <= 18)) {
          density += 30;
        }
        if (day >= 1 && day <= 5) {
          density += 20;
        }
        density = Math.min(100, density);

        await pool.execute(
          'INSERT INTO density_data (zone_id, hour, day_of_week, density_score, data_source, reliability_score) VALUES (?, ?, ?, ?, ?, ?)',
          [zone.id, hour, day, density.toFixed(2), 'simulated', 0.75]
        );
      }
    }
  }

  console.log('✅ Sample data inserted');
};

module.exports = {
  pool,
  initialize
};
