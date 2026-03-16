const db = require('../config/baseDonnees');
require('dotenv').config();

/**
 * Script pour initialiser des défis Premium exclusifs
 */
async function initPremiumChallenges() {
  try {
    await db.initialize();
    
    const premiumChallenges = [
      {
        title: 'Maître des Prédictions',
        description: 'Utilisez 100 prédictions ML pour vos trajets',
        challenge_type: 'ml_predictions',
        target_value: 100,
        reward_points: 500,
        start_date: null,
        end_date: null,
        is_active: true,
        is_premium: true
      },
      {
        title: 'Explorateur Elite',
        description: 'Visitez 50 zones différentes',
        challenge_type: 'zones',
        target_value: 50,
        reward_points: 400,
        start_date: null,
        end_date: null,
        is_active: true,
        is_premium: true
      },
      {
        title: 'Ultra Sérénité',
        description: 'Choisissez 50 trajets calmes (densité < 30)',
        challenge_type: 'calm',
        target_value: 50,
        reward_points: 600,
        start_date: null,
        end_date: null,
        is_active: true,
        is_premium: true
      },
      {
        title: 'Marathon Premium',
        description: 'Parcourez 200 km au total',
        challenge_type: 'distance',
        target_value: 200,
        reward_points: 800,
        start_date: null,
        end_date: null,
        is_active: true,
        is_premium: true
      },
      {
        title: 'Légende du Streak',
        description: 'Maintenez un streak de 100 jours consécutifs',
        challenge_type: 'streak',
        target_value: 100,
        reward_points: 1000,
        start_date: null,
        end_date: null,
        is_active: true,
        is_premium: true
      },
      {
        title: 'Collectionneur Premium',
        description: 'Débloquez tous les badges Premium',
        challenge_type: 'badges',
        target_value: 8,
        reward_points: 1500,
        start_date: null,
        end_date: null,
        is_active: true,
        is_premium: true
      }
    ];

    for (const challenge of premiumChallenges) {
      await db.pool.execute(
        `INSERT INTO challenges (title, description, challenge_type, target_value, reward_points, start_date, end_date, is_active, is_premium)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           description = VALUES(description),
           challenge_type = VALUES(challenge_type),
           target_value = VALUES(target_value),
           reward_points = VALUES(reward_points),
           is_active = VALUES(is_active),
           is_premium = VALUES(is_premium)`,
        [
          challenge.title,
          challenge.description,
          challenge.challenge_type,
          challenge.target_value,
          challenge.reward_points,
          challenge.start_date,
          challenge.end_date,
          challenge.is_active,
          challenge.is_premium
        ]
      );
    }

    console.log('✅ Défis Premium initialisés avec succès');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation des défis Premium:', error);
    process.exit(1);
  }
}

initPremiumChallenges();
