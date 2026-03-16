const express = require('express');
const db = require('../config/baseDonnees');
const authenticate = require('../middleware/authentification');
const { isPremium } = require('./premium');

const router = express.Router();

// Points par action
const POINTS = {
  PLAN_ROUTE: 10,
  COMPLETE_ROUTE: 20,
  MOOD_ENTRY: 5,
  CALM_ROUTE: 15,
  NEW_ZONE: 25,
  CHALLENGE_COMPLETE: 50,
  // Multiplicateur premium
  PREMIUM_MULTIPLIER: 1.5 // +50% de points pour les utilisateurs premium
};

// Points nécessaires par niveau (niveau 1 = 0, niveau 2 = 100, niveau 3 = 250, etc.)
function getPointsForLevel(level) {
  if (level === 1) return 0;
  return Math.floor(100 * Math.pow(1.5, level - 2));
}

// Badges disponibles
const BADGES = {
  // Badges gratuits
  FIRST_STEP: { id: 'first_step', name: 'Premier pas', icon: '🏃', description: 'Premier trajet planifié', premium: false },
  EXPLORER: { id: 'explorer', name: 'Explorateur', icon: '🎯', description: '10 zones différentes visitées', premium: false },
  ZEN: { id: 'zen', name: 'Zen', icon: '🧘', description: '10 trajets avec densité < 30', premium: false },
  WALKER: { id: 'walker', name: 'Marcheur', icon: '🚶', description: '50 km parcourus', premium: false },
  LOCAL: { id: 'local', name: 'Local', icon: '📍', description: '20 trajets dans la même ville', premium: false },
  NIGHT_OWL: { id: 'night_owl', name: 'Nocturne', icon: '🌙', description: '10 trajets après 20h', premium: false },
  EARLY_BIRD: { id: 'early_bird', name: 'Lève-tôt', icon: '🌅', description: '10 trajets avant 8h', premium: false },
  PERSISTENT: { id: 'persistent', name: 'Persévérant', icon: '💪', description: '30 jours consécutifs', premium: false },
  VETERAN: { id: 'veteran', name: 'Vétéran', icon: '🎖️', description: '100 trajets au total', premium: false },
  STREAK_7: { id: 'streak_7', name: 'Série de 7 jours', icon: '🔥', description: '7 jours consécutifs', premium: false },
  STREAK_30: { id: 'streak_30', name: 'Série de 30 jours', icon: '🔥🔥', description: '30 jours consécutifs', premium: false },
  ARRIVED: { id: 'arrived', name: 'Arrivé à destination', icon: '🎯', description: 'Première arrivée confirmée', premium: false },
  ARRIVED_10: { id: 'arrived_10', name: 'Voyageur régulier', icon: '✈️', description: '10 arrivées confirmées', premium: false },
  ARRIVED_50: { id: 'arrived_50', name: 'Explorateur confirmé', icon: '🌍', description: '50 arrivées confirmées', premium: false },
  
  // Badges Premium exclusifs
  PREMIUM_MEMBER: { id: 'premium_member', name: 'Membre Premium', icon: '⭐', description: 'Abonnement Premium actif', premium: true },
  PREMIUM_MASTER: { id: 'premium_master', name: 'Maître Premium', icon: '👑', description: 'Premium depuis 6 mois', premium: true },
  ELITE_EXPLORER: { id: 'elite_explorer', name: 'Explorateur Elite', icon: '🗺️', description: '50 zones différentes visitées (Premium)', premium: true },
  ZEN_MASTER: { id: 'zen_master', name: 'Maître Zen', icon: '🧘‍♂️', description: '50 trajets calmes (Premium)', premium: true },
  ULTRA_WALKER: { id: 'ultra_walker', name: 'Ultra Marcheur', icon: '🚶‍♂️', description: '200 km parcourus (Premium)', premium: true },
  ML_PREDICTOR: { id: 'ml_predictor', name: 'Prédicteur ML', icon: '🤖', description: '100 prédictions ML utilisées (Premium)', premium: true },
  CHALLENGE_CHAMPION: { id: 'challenge_champion', name: 'Champion des Défis', icon: '🏆', description: '10 défis premium complétés', premium: true },
  STREAK_LEGEND: { id: 'streak_legend', name: 'Légende', icon: '🔥🔥🔥', description: '100 jours consécutifs (Premium)', premium: true }
};

// Initialiser les points d'un utilisateur
async function ensureUserPoints(userId) {
  const [existing] = await db.pool.execute('SELECT * FROM user_points WHERE user_id = ?', [userId]);
  if (existing.length === 0) {
    await db.pool.execute(
      'INSERT INTO user_points (user_id, total_points, current_level, current_streak, longest_streak) VALUES (?, 0, 1, 0, 0)',
      [userId]
    );
  }
}

// Ajouter des points et mettre à jour le niveau
async function addPoints(userId, points, reason) {
  await ensureUserPoints(userId);
  
  // Vérifier si l'utilisateur est premium pour appliquer le multiplicateur
  const premium = await isPremium(userId);
  const multiplier = premium ? POINTS.PREMIUM_MULTIPLIER : 1;
  const finalPoints = Math.floor(points * multiplier);
  const bonusPoints = premium ? finalPoints - points : 0;
  
  // Enregistrer dans l'historique
  await db.pool.execute(
    'INSERT INTO points_history (user_id, points, reason) VALUES (?, ?, ?)',
    [userId, finalPoints, bonusPoints > 0 ? `${reason} (+${bonusPoints} bonus Premium)` : reason]
  );
  
  // Mettre à jour les points totaux
  const [userPoints] = await db.pool.execute(
    'SELECT total_points, current_level FROM user_points WHERE user_id = ?',
    [userId]
  );
  
  const newTotal = (userPoints[0].total_points || 0) + finalPoints;
  let newLevel = userPoints[0].current_level || 1;
  
  // Vérifier si un nouveau niveau est atteint
  while (newTotal >= getPointsForLevel(newLevel + 1)) {
    newLevel++;
  }
  
  await db.pool.execute(
    'UPDATE user_points SET total_points = ?, current_level = ? WHERE user_id = ?',
    [newTotal, newLevel, userId]
  );
  
  return { 
    newTotal, 
    newLevel, 
    levelUp: newLevel > (userPoints[0].current_level || 1),
    pointsEarned: finalPoints,
    basePoints: points,
    bonusPoints: bonusPoints,
    isPremium: !!premium
  };
}

// Mettre à jour le streak
async function updateStreak(userId) {
  await ensureUserPoints(userId);
  
  const today = new Date().toISOString().slice(0, 10);
  const [userPoints] = await db.pool.execute(
    'SELECT current_streak, longest_streak, last_activity_date FROM user_points WHERE user_id = ?',
    [userId]
  );
  
  const lastActivity = userPoints[0].last_activity_date ? new Date(userPoints[0].last_activity_date).toISOString().slice(0, 10) : null;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  
  let newStreak = userPoints[0].current_streak || 0;
  let longestStreak = userPoints[0].longest_streak || 0;
  
  if (lastActivity === today) {
    // Déjà mis à jour aujourd'hui
    return { currentStreak: newStreak, longestStreak };
  } else if (lastActivity === yesterday) {
    // Suite de la série
    newStreak = (newStreak || 0) + 1;
  } else {
    // Nouvelle série
    newStreak = 1;
  }
  
  if (newStreak > longestStreak) {
    longestStreak = newStreak;
  }
  
  await db.pool.execute(
    'UPDATE user_points SET current_streak = ?, longest_streak = ?, last_activity_date = ? WHERE user_id = ?',
    [newStreak, longestStreak, today, userId]
  );
  
  // Vérifier les badges de streak
  if (newStreak === 7) {
    await checkAndAwardBadge(userId, 'streak_7');
  } else if (newStreak === 30) {
    await checkAndAwardBadge(userId, 'streak_30');
  }
  
  return { currentStreak: newStreak, longestStreak };
}

// Vérifier et attribuer un badge
async function checkAndAwardBadge(userId, badgeId) {
  const [existing] = await db.pool.execute(
    'SELECT * FROM user_badges WHERE user_id = ? AND badge_id = ?',
    [userId, badgeId]
  );
  
  if (existing.length === 0) {
    await db.pool.execute(
      'INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?)',
      [userId, badgeId]
    );
    return true;
  }
  return false;
}

// GET /api/gamification/points - Récupérer les points et le niveau
router.get('/points', authenticate, async (req, res) => {
  try {
    await ensureUserPoints(req.user.userId);
    const [points] = await db.pool.execute(
      'SELECT * FROM user_points WHERE user_id = ?',
      [req.user.userId]
    );
    
    const userPoints = points[0] || { total_points: 0, current_level: 1, current_streak: 0, longest_streak: 0 };
    const pointsForNextLevel = getPointsForLevel(userPoints.current_level + 1);
    const pointsNeeded = pointsForNextLevel - userPoints.total_points;
    
    res.json({
      totalPoints: userPoints.total_points || 0,
      currentLevel: userPoints.current_level || 1,
      currentStreak: userPoints.current_streak || 0,
      longestStreak: userPoints.longest_streak || 0,
      pointsForNextLevel: pointsForNextLevel,
      pointsNeeded: pointsNeeded,
      progress: userPoints.total_points >= pointsForNextLevel ? 100 : 
        Math.max(0, Math.floor(((userPoints.total_points - getPointsForLevel(userPoints.current_level)) / 
        (pointsForNextLevel - getPointsForLevel(userPoints.current_level))) * 100))
    });
  } catch (error) {
    console.error('Get points error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/gamification/badges - Récupérer tous les badges de l'utilisateur
router.get('/badges', authenticate, async (req, res) => {
  try {
    const premium = await isPremium(req.user.userId);
    const [badges] = await db.pool.execute(
      'SELECT badge_id, unlocked_at FROM user_badges WHERE user_id = ? ORDER BY unlocked_at DESC',
      [req.user.userId]
    );
    
    // Filtrer les badges selon le statut premium
    const allBadges = Object.values(BADGES)
      .filter(badge => !badge.premium || premium) // Afficher seulement les badges premium si l'utilisateur est premium
      .map(badge => ({
        ...badge,
        unlocked: badges.some(b => b.badge_id === badge.id),
        unlockedAt: badges.find(b => b.badge_id === badge.id)?.unlocked_at || null,
        locked: badge.premium && !premium && !badges.some(b => b.badge_id === badge.id)
      }));
    
    res.json({
      unlocked: badges.length,
      total: allBadges.length,
      isPremium: !!premium,
      badges: allBadges
    });
  } catch (error) {
    console.error('Get badges error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/gamification/add-points - Ajouter des points (appelé automatiquement par d'autres routes)
router.post('/add-points', authenticate, async (req, res) => {
  try {
    const { points, reason } = req.body;
    if (!points || !reason) {
      return res.status(400).json({ message: 'Points and reason required' });
    }
    
    const result = await addPoints(req.user.userId, points, reason);
    await updateStreak(req.user.userId);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Add points error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/gamification/challenges - Récupérer les défis actifs
router.get('/challenges', authenticate, async (req, res) => {
  try {
    const premium = await isPremium(req.user.userId);
    const today = new Date().toISOString().slice(0, 10);
    const [challenges] = await db.pool.execute(
      `SELECT * FROM challenges 
       WHERE is_active = TRUE
       AND (start_date IS NULL OR start_date <= ?) 
       AND (end_date IS NULL OR end_date >= ?)
       ORDER BY is_premium ASC, start_date DESC`,
      [today, today]
    );
    
    // Filtrer les défis premium si l'utilisateur n'est pas premium
    const availableChallenges = challenges.filter(c => !c.is_premium || premium);
    
    // Récupérer la progression de l'utilisateur
    const challengeIds = availableChallenges.map(c => c.id);
    let progress = [];
    if (challengeIds.length > 0) {
      const placeholders = challengeIds.map(() => '?').join(',');
      const [userProgress] = await db.pool.execute(
        `SELECT * FROM user_challenge_progress 
         WHERE user_id = ? AND challenge_id IN (${placeholders})`,
        [req.user.userId, ...challengeIds]
      );
      progress = userProgress;
    }
    
    const challengesWithProgress = availableChallenges.map(challenge => {
      const prog = progress.find(p => p.challenge_id === challenge.id);
      return {
        ...challenge,
        progress: prog?.progress || 0,
        completed: prog?.completed || false,
        completedAt: prog?.completed_at || null,
        progressPercent: Math.min(100, Math.floor((prog?.progress || 0) / challenge.target_value * 100))
      };
    });
    
    res.json({
      challenges: challengesWithProgress,
      isPremium: !!premium
    });
  } catch (error) {
    console.error('Get challenges error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/gamification/leaderboard - Récupérer le classement
router.get('/leaderboard', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const [leaderboard] = await db.pool.execute(
      `SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        up.total_points,
        up.current_level,
        up.current_streak,
        up.longest_streak,
        (SELECT COUNT(*) FROM user_badges WHERE user_id = u.id) as badge_count
      FROM users u
      LEFT JOIN user_points up ON u.id = up.user_id
      WHERE up.total_points > 0
      ORDER BY up.total_points DESC, up.current_level DESC
      LIMIT ?`,
      [limit]
    );
    
    // Ajouter le rang
    const leaderboardWithRank = leaderboard.map((user, index) => ({
      ...user,
      rank: index + 1
    }));
    
    // Trouver la position de l'utilisateur actuel
    const [userRank] = await db.pool.execute(
      `SELECT COUNT(*) + 1 as rank
       FROM user_points
       WHERE total_points > (SELECT total_points FROM user_points WHERE user_id = ?)
       OR (total_points = (SELECT total_points FROM user_points WHERE user_id = ?) 
           AND user_id < ?)`,
      [req.user.userId, req.user.userId, req.user.userId]
    );
    
    res.json({
      leaderboard: leaderboardWithRank,
      userRank: userRank[0]?.rank || null
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/gamification/history - Historique des points
router.get('/history', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const [history] = await db.pool.execute(
      `SELECT points, reason, created_at 
       FROM points_history 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [req.user.userId, limit]
    );
    
    res.json(history);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/gamification/confirm-arrival - Confirmer l'arrivée à destination
router.post('/confirm-arrival', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Ajouter des points pour l'arrivée
    const result = await addPoints(userId, POINTS.COMPLETE_ROUTE, 'Arrivée à destination confirmée');
    await updateStreak(userId);
    
    // Compter le nombre d'arrivées confirmées
    const [arrivalHistory] = await db.pool.execute(
      `SELECT COUNT(*) as count 
       FROM points_history 
       WHERE user_id = ? AND reason LIKE '%Arrivée à destination%'`,
      [userId]
    );
    
    const arrivalCount = arrivalHistory[0]?.count || 0;
    let newBadge = null;
    
    // Vérifier et attribuer des badges selon le nombre d'arrivées
    if (arrivalCount === 1) {
      const awarded = await checkAndAwardBadge(userId, 'arrived');
      if (awarded && BADGES.ARRIVED) newBadge = BADGES.ARRIVED;
    } else if (arrivalCount === 10) {
      const awarded = await checkAndAwardBadge(userId, 'arrived_10');
      if (awarded && BADGES.ARRIVED_10) newBadge = BADGES.ARRIVED_10;
    } else if (arrivalCount === 50) {
      const awarded = await checkAndAwardBadge(userId, 'arrived_50');
      if (awarded && BADGES.ARRIVED_50) newBadge = BADGES.ARRIVED_50;
    }
    
    res.json({
      success: true,
      message: 'Félicitations ! Vous êtes arrivé à destination ! 🎉',
      points: result.newTotal,
      level: result.newLevel,
      arrivalCount,
      newBadge
    });
  } catch (error) {
    console.error('Confirm arrival error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/gamification/update-challenge - Mettre à jour la progression d'un défi
router.post('/update-challenge', authenticate, async (req, res) => {
  try {
    const { challengeId, progress } = req.body;
    
    if (!challengeId || progress === undefined) {
      return res.status(400).json({ message: 'Challenge ID and progress required' });
    }
    
    // Récupérer le défi
    const [challenges] = await db.pool.execute(
      'SELECT * FROM challenges WHERE id = ?',
      [challengeId]
    );
    
    if (challenges.length === 0) {
      return res.status(404).json({ message: 'Challenge not found' });
    }
    
    const challenge = challenges[0];
    const isCompleted = progress >= challenge.target_value;
    
    // Mettre à jour ou créer la progression
    await db.pool.execute(
      `INSERT INTO user_challenge_progress (user_id, challenge_id, progress, completed, completed_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         progress = VALUES(progress),
         completed = VALUES(completed),
         completed_at = VALUES(completed_at),
         updated_at = CURRENT_TIMESTAMP`,
      [
        req.user.userId,
        challengeId,
        Math.min(progress, challenge.target_value),
        isCompleted,
        isCompleted ? new Date() : null
      ]
    );
    
    // Si le défi est complété et pas encore récompensé, donner les points
    if (isCompleted) {
      const [existing] = await db.pool.execute(
        'SELECT completed FROM user_challenge_progress WHERE user_id = ? AND challenge_id = ?',
        [req.user.userId, challengeId]
      );
      
      if (existing.length > 0 && !existing[0].completed) {
        await addPoints(req.user.userId, challenge.reward_points || POINTS.CHALLENGE_COMPLETE, `Défi complété: ${challenge.title}`);
      }
    }
    
    res.json({
      success: true,
      progress: Math.min(progress, challenge.target_value),
      completed: isCompleted,
      progressPercent: Math.min(100, Math.floor((progress / challenge.target_value) * 100))
    });
  } catch (error) {
    console.error('Update challenge error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
module.exports.addPoints = addPoints;
module.exports.updateStreak = updateStreak;
module.exports.checkAndAwardBadge = checkAndAwardBadge;
module.exports.POINTS = POINTS;
module.exports.BADGES = BADGES;
