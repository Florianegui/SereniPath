const db = require('../config/baseDonnees');
require('dotenv').config();

/**
 * Script pour initialiser des défis par défaut dans la base de données
 */
async function initChallenges() {
  try {
    await db.initialize();
    
    const challenges = [
      {
        title: 'Premier pas',
        description: 'Planifiez votre premier trajet avec SereniPath',
        challenge_type: 'routes',
        target_value: 1,
        reward_points: 50,
        start_date: null,
        end_date: null,
        is_active: true
      },
      {
        title: 'Explorateur',
        description: 'Planifiez 10 trajets différents',
        challenge_type: 'routes',
        target_value: 10,
        reward_points: 100,
        start_date: null,
        end_date: null,
        is_active: true
      },
      {
        title: 'Marathonien',
        description: 'Parcourez 50 km au total',
        challenge_type: 'distance',
        target_value: 50,
        reward_points: 150,
        start_date: null,
        end_date: null,
        is_active: true
      },
      {
        title: 'Sérénité',
        description: 'Choisissez 10 trajets calmes (densité < 30)',
        challenge_type: 'calm',
        target_value: 10,
        reward_points: 200,
        start_date: null,
        end_date: null,
        is_active: true
      },
      {
        title: 'Suivi régulier',
        description: 'Enregistrez votre humeur pendant 7 jours consécutifs',
        challenge_type: 'streak',
        target_value: 7,
        reward_points: 100,
        start_date: null,
        end_date: null,
        is_active: true
      },
      {
        title: 'Découverte',
        description: 'Visitez 5 zones différentes',
        challenge_type: 'zones',
        target_value: 5,
        reward_points: 125,
        start_date: null,
        end_date: null,
        is_active: true
      }
    ];

    for (const challenge of challenges) {
      await db.pool.execute(
        `INSERT INTO challenges (title, description, challenge_type, target_value, reward_points, start_date, end_date, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           description = VALUES(description),
           challenge_type = VALUES(challenge_type),
           target_value = VALUES(target_value),
           reward_points = VALUES(reward_points),
           is_active = VALUES(is_active)`,
        [
          challenge.title,
          challenge.description,
          challenge.challenge_type,
          challenge.target_value,
          challenge.reward_points,
          challenge.start_date,
          challenge.end_date,
          challenge.is_active
        ]
      );
    }

    console.log('✅ Challenges initialisés avec succès');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation des défis:', error);
    process.exit(1);
  }
}

initChallenges();
