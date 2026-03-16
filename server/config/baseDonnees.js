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
    
    // Migrate existing tables (add new columns if they don't exist)
    await migrateTables();
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
};

const migrateTables = async () => {
  try {
    // Vérifier et ajouter les colonnes transport_type et density_level à la table routes
    const [columns] = await pool.execute(
      `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'routes' 
       AND COLUMN_NAME IN ('transport_type', 'density_level')`
    );
    
    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    if (!existingColumns.includes('transport_type')) {
      await pool.execute(
        `ALTER TABLE routes 
         ADD COLUMN transport_type VARCHAR(20) DEFAULT 'walking',
         ADD INDEX idx_transport_type (transport_type)`
      );
      console.log('✅ Added transport_type column to routes table');
    }
    
    if (!existingColumns.includes('density_level')) {
      await pool.execute(
        `ALTER TABLE routes 
         ADD COLUMN density_level VARCHAR(20),
         ADD INDEX idx_density_level (density_level)`
      );
      console.log('✅ Added density_level column to routes table');
      
      // Mettre à jour les routes existantes avec density_level basé sur density_score
      await pool.execute(
        `UPDATE routes 
         SET density_level = CASE 
           WHEN density_score < 30 THEN 'calm'
           WHEN density_score >= 30 AND density_score < 60 THEN 'moderate'
           WHEN density_score >= 60 THEN 'elevated'
           ELSE NULL
         END
         WHERE density_level IS NULL AND density_score IS NOT NULL`
      );
      console.log('✅ Updated existing routes with density_level');
    }

    // Créer la table journal_entries si elle n'existe pas (migration)
    const [tables] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entries'`
    );
    if (tables.length === 0) {
      await pool.execute(
        `CREATE TABLE journal_entries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_user_created (user_id, created_at)
        )`
      );
      console.log('✅ Table journal_entries créée');
    }

    // Table lieux sécurisants (favoris)
    const [safeTables] = await pool.execute(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'safe_places'`
    );
    if (safeTables.length === 0) {
      await pool.execute(
        `CREATE TABLE safe_places (
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
        )`
      );
      console.log('✅ Table safe_places créée');
    }
  } catch (error) {
    console.error('Migration error (non-critical):', error.message);
    // Ne pas bloquer le démarrage si la migration échoue
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
      transport_type VARCHAR(20) DEFAULT 'walking',
      density_level VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_user_created (user_id, created_at),
      INDEX idx_transport_type (transport_type),
      INDEX idx_density_level (density_level)
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
    )`,
    
    // ML Predictions: stocke les prédictions d'anxiété pour analyse
    `CREATE TABLE IF NOT EXISTS ml_predictions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      start_lat DECIMAL(10, 8) NOT NULL,
      start_lng DECIMAL(11, 8) NOT NULL,
      end_lat DECIMAL(10, 8) NOT NULL,
      end_lng DECIMAL(11, 8) NOT NULL,
      predicted_anxiety_level INT NOT NULL,
      confidence DECIMAL(3, 2),
      factors JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_date (user_id, created_at)
    )`,
    
    // Gamification: Points et niveaux utilisateur
    `CREATE TABLE IF NOT EXISTS user_points (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      total_points INT DEFAULT 0,
      current_level INT DEFAULT 1,
      current_streak INT DEFAULT 0,
      longest_streak INT DEFAULT 0,
      last_activity_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    
    // Historique des points
    `CREATE TABLE IF NOT EXISTS points_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      points INT NOT NULL,
      reason VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_date (user_id, created_at)
    )`,
    
    // Badges débloqués par utilisateur
    `CREATE TABLE IF NOT EXISTS user_badges (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      badge_id VARCHAR(50) NOT NULL,
      unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_badge (user_id, badge_id),
      INDEX idx_user (user_id)
    )`,
    
    // Défis/Challenges
    `CREATE TABLE IF NOT EXISTS challenges (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      challenge_type VARCHAR(50) NOT NULL,
      target_value INT NOT NULL,
      reward_points INT DEFAULT 0,
      start_date DATE,
      end_date DATE,
      is_active BOOLEAN DEFAULT TRUE,
      is_premium BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    
    // Progression des utilisateurs dans les défis
    `CREATE TABLE IF NOT EXISTS user_challenge_progress (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      challenge_id INT NOT NULL,
      progress INT DEFAULT 0,
      completed BOOLEAN DEFAULT FALSE,
      completed_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
      UNIQUE KEY unique_user_challenge (user_id, challenge_id),
      INDEX idx_user (user_id)
    )`,
    
    // Abonnements Premium
    `CREATE TABLE IF NOT EXISTS premium_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      plan VARCHAR(20) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_status (user_id, status),
      INDEX idx_end_date (end_date)
    )`,

    // Analyse de sentiment (réseaux sociaux : Google, Twitter, forums)
    `CREATE TABLE IF NOT EXISTS sentiment_analyses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      place_id VARCHAR(255),
      place_name VARCHAR(255),
      source VARCHAR(50) NOT NULL,
      text TEXT,
      sentiment_score DECIMAL(5, 2),
      keywords JSON,
      latitude DECIMAL(10, 8),
      longitude DECIMAL(11, 8),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_place_source (place_id, source),
      INDEX idx_location (latitude, longitude),
      INDEX idx_created (created_at)
    )`,

    // Zones mentionnées comme problématiques (sentiment négatif)
    `CREATE TABLE IF NOT EXISTS problematic_zones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      latitude DECIMAL(10, 8) NOT NULL,
      longitude DECIMAL(11, 8) NOT NULL,
      negative_mentions INT DEFAULT 0,
      last_mentioned_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_location (latitude, longitude)
    )`,

    // Journal intime (notes personnelles par utilisateur)
    `CREATE TABLE IF NOT EXISTS journal_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_created (user_id, created_at)
    )`,

    // Lieux sécurisants (favoris utilisateur)
    `CREATE TABLE IF NOT EXISTS safe_places (
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

  // Insert sample challenges if none exist
  const [challengesCount] = await pool.execute('SELECT COUNT(*) as count FROM challenges');
  if (challengesCount[0].count === 0) {
    await insertSampleChallenges();
  }
};

const insertSampleChallenges = async () => {
  const challenges = [
    { title: 'Premier pas', description: 'Planifiez votre premier trajet avec SereniPath', challenge_type: 'routes', target_value: 1, reward_points: 50 },
    { title: 'Explorateur', description: 'Planifiez 10 trajets différents', challenge_type: 'routes', target_value: 10, reward_points: 100 },
    { title: 'Marathonien', description: 'Parcourez 50 km au total', challenge_type: 'distance', target_value: 50, reward_points: 150 },
    { title: 'Sérénité', description: 'Choisissez 10 trajets calmes (densité < 30)', challenge_type: 'calm', target_value: 10, reward_points: 200 },
    { title: 'Suivi régulier', description: 'Enregistrez votre humeur pendant 7 jours consécutifs', challenge_type: 'streak', target_value: 7, reward_points: 100 },
    { title: 'Découverte', description: 'Visitez 5 zones différentes', challenge_type: 'zones', target_value: 5, reward_points: 125 }
  ];
  for (const c of challenges) {
    await pool.execute(
      `INSERT INTO challenges (title, description, challenge_type, target_value, reward_points, start_date, end_date, is_active, is_premium)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, TRUE, FALSE)`,
      [c.title, c.description, c.challenge_type, c.target_value, c.reward_points]
    );
  }
  console.log('✅ Defis par defaut inseres');
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
