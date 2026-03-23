const express = require('express');
const db = require('../config/baseDonnees');
const authenticate = require('../middleware/authentification');
const { addPoints, updateStreak, POINTS } = require('./gamification');

const router = express.Router();

// Moods: great = très bien, good = bien, okay = correct, meh = bof, bad = difficile
const MOODS = ['great', 'good', 'okay', 'meh', 'bad'];

// GET /api/mood?year=2025&month=1 — récupère les entrées du mois + récompense si mois terminé
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // dernier jour du mois

    const [rows] = await db.pool.execute(
      `SELECT entry_date, mood FROM mood_entries 
       WHERE user_id = ? AND entry_date >= ? AND entry_date <= ?
       ORDER BY entry_date`,
      [userId, startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)]
    );

    const entriesByDate = {};
    rows.forEach(r => {
      entriesByDate[r.entry_date.toISOString().slice(0, 10)] = r.mood;
    });

    const today = new Date();
    const isMonthComplete = today.getFullYear() > year || (today.getFullYear() === year && today.getMonth() + 1 > month);
    const daysInMonth = endDate.getDate();

    let reward = null;
    if (isMonthComplete) {
      const goodMoods = ['great', 'good'];
      const goodDays = rows.filter(r => goodMoods.includes(r.mood)).length;
      reward = getRewardForMonth(goodDays, daysInMonth);
    }

    res.json({
      year,
      month,
      daysInMonth,
      entries: entriesByDate,
      isMonthComplete: !!isMonthComplete,
      reward
    });
  } catch (err) {
    console.error('Mood GET error:', err);
    res.status(500).json({ message: 'Erreur lors de la récupération des humeurs' });
  }
});

// POST /api/mood — enregistre ou met à jour l'humeur d'un jour
// body: { date: "2025-01-15", mood: "great" }
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { date, mood } = req.body;

    if (!date || !mood) {
      return res.status(400).json({ message: 'Date et humeur requis' });
    }
    if (!MOODS.includes(mood)) {
      return res.status(400).json({ message: 'Humeur invalide. Valeurs: ' + MOODS.join(', ') });
    }

    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ message: 'Date invalide' });
    }

    const dateStr = d.toISOString().slice(0, 10);

    const [existing] = await db.pool.execute(
      'SELECT * FROM mood_entries WHERE user_id = ? AND entry_date = ?',
      [userId, dateStr]
    );
    const isNew = existing.length === 0;
    
    await db.pool.execute(
      `INSERT INTO mood_entries (user_id, entry_date, mood) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE mood = VALUES(mood)`,
      [userId, dateStr, mood]
    );

    // Attribuer des points si nouvelle entrée
    if (isNew) {
      try {
        await addPoints(userId, POINTS.MOOD_ENTRY, 'Humeur enregistrée');
        await updateStreak(userId);
      } catch (gamifError) {
        console.error('Gamification error (non-blocking):', gamifError);
      }
    }

    res.json({ success: true, date: dateStr, mood });
  } catch (err) {
    console.error('Mood POST error:', err);
    res.status(500).json({ message: 'Erreur lors de l\'enregistrement' });
  }
});

function getRewardForMonth(goodDaysCount, daysInMonth) {
  const ratio = goodDaysCount / Math.max(1, daysInMonth);
  if (ratio >= 0.8) {
    return {
      level: 'gold',
      title: 'Mois serein',
      message: `Bravo ! ${goodDaysCount} jour${goodDaysCount > 1 ? 's' : ''} bien vécus ce mois-ci. Vous méritez une pause bien-être : prenez 30 min pour une balade ou un exercice de respiration.`,
      icon: '🌟'
    };
  }
  if (ratio >= 0.6) {
    return {
      level: 'silver',
      title: 'Bon mois',
      message: `${goodDaysCount} jour${goodDaysCount > 1 ? 's' : ''} positifs. Continuez à privilégier les itinéraires calmes pour encore plus de sérénité.`,
      icon: '✨'
    };
  }
  if (ratio >= 0.4) {
    return {
      level: 'bronze',
      title: 'Mois en progrès',
      message: 'Chaque petit pas compte. Essayez "Planifier un trajet" pour découvrir des chemins plus apaisants.',
      icon: '🍃'
    };
  }
  return {
    level: 'encouragement',
    title: 'On repart sur de bonnes bases',
    message: 'Le mois prochain peut être différent : Zénova est là pour vous aider à trouver des trajets plus sereins.',
    icon: '💚'
  };
}

module.exports = router;
