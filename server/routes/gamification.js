const express = require('express');
const db = require('../config/database');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Points par action
const POINTS = {
  PLAN_ROUTE: 10,
  COMPLETE_ROUTE: 20,
  MOOD_ENTRY: 5,
  CALM_ROUTE: 15,
  NEW_ZONE: 25,
  CHALLENGE_COMPLETE: 50
};

// Points nécessaires par niveau (niveau 1 = 0, niveau 2 = 100, niveau 3 = 250, etc.)
function getPointsForLevel(level) {
  if (level === 1) return 0;
  return Math.floor(100 * Math.pow(1.5, level - 2));
}

// Badges disponibles
const BADGES = {
  FIRST_STEP: { id: 'first_step', name: 'Premier pas', icon: '🏃', description: 'Premier trajet planifié' },
  EXPLORER: { id: 'explorer', name: 'Explorateur', icon: '🎯', description: '10 zones différentes visitées' },
  ZEN: { id: 'zen', name: 'Zen', icon: '🧘', description: '10 trajets avec densité < 30' },
  WALKER: { id: 'walker', name: 'Marcheur', icon: '🚶', description: '50 km parcourus' },
  LOCAL: { id: 'local', name: 'Local', icon: '📍', description: '20 trajets dans la même ville' },
  NIGHT_OWL: { id: 'night_owl', name: 'Nocturne', icon: '🌙', description: '10 trajets après 20h' },
  EARLY_BIRD: { id: 'early_bird', name: 'Lève-tôt', icon: '🌅', description: '10 trajets avant 8h' },
  PERSISTENT: { id: 'persistent', name: 'Persévérant', icon: '💪', description: '30 jours consécutifs' },
  VETERAN: { id: 'veteran', name: 'Vétéran', icon: '🎖️', description: '100 trajets au total' },
  STREAK_7: { id: 'streak_7', name: 'Série de 7 jours', icon: '🔥', description: '7 jours consécutifs' },
  STREAK_30: { id: 'streak_30', name: 'Série de 30 jours', icon: '🔥🔥', description: '30 jours consécutifs' }
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
  
  // Enregistrer dans l'historique
  await db.pool.execute(
    'INSERT INTO points_history (user_id, points, reason) VALUES (?, ?, ?)',
    [userId, points, reason]
  );
  
  // Mettre à jour les points totaux
  const [userPoints] = await db.pool.execute(
    'SELECT total_points, current_level FROM user_points WHERE user_id = ?',
    [userId]
  );
  
  const newTotal = (userPoints[0].total_points || 0) + points;
  let newLevel = userPoints[0].current_level || 1;
  
  // Vérifier si un nouveau niveau est atteint
  while (newTotal >= getPointsForLevel(newLevel + 1)) {
    newLevel++;
  }
  
  await db.pool.execute(
    'UPDATE user_points SET total_points = ?, current_level = ? WHERE user_id = ?',
    [newTotal, newLevel, userId]
  );
  
  return { newTotal, newLevel, levelUp: newLevel > (userPoints[0].current_level || 1) };
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
    const [badges] = await db.pool.execute(
      'SELECT badge_id, unlocked_at FROM user_badges WHERE user_id = ? ORDER BY unlocked_at DESC',
      [req.user.userId]
    );
    
    const allBadges = Object.values(BADGES).map(badge => ({
      ...badge,
      unlocked: badges.some(b => b.badge_id === badge.id),
      unlockedAt: badges.find(b => b.badge_id === badge.id)?.unlocked_at || null
    }));
    
    res.json({
      unlocked: badges.length,
      total: allBadges.length,
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
    const today = new Date().toISOString().slice(0, 10);
    const [challenges] = await db.pool.execute(
      `SELECT * FROM challenges 
       WHERE (start_date IS NULL OR start_date <= ?) 
       AND (end_date IS NULL OR end_date >= ?)
       ORDER BY start_date DESC`,
      [today, today]
    );
    
    // Récupérer la progression de l'utilisateur
    const challengeIds = challenges.map(c => c.id);
    let progress = [];
    if (challengeIds.length > 0) {
      const [userProgress] = await db.pool.execute(
        `SELECT * FROM user_challenge_progress 
         WHERE user_id = ? AND challenge_id IN (${challengeIds.join(',')})`,
        [req.user.userId]
      );
      progress = userProgress;
    }
    
    const challengesWithProgress = challenges.map(challenge => {
      const prog = progress.find(p => p.challenge_id === challenge.id);
      return {
        ...challenge,
        progress: prog?.progress || 0,
        completed: prog?.completed || false,
        completedAt: prog?.completed_at || null
      };
    });
    
    res.json(challengesWithProgress);
  } catch (error) {
    console.error('Get challenges error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
module.exports.addPoints = addPoints;
module.exports.updateStreak = updateStreak;
module.exports.checkAndAwardBadge = checkAndAwardBadge;
module.exports.POINTS = POINTS;
module.exports.BADGES = BADGES;
