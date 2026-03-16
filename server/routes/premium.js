const express = require('express');
const db = require('../config/baseDonnees');
const authenticate = require('../middleware/authentification');

const router = express.Router();

// Vérifier si un utilisateur a un abonnement premium actif
async function isPremium(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const [subscriptions] = await db.pool.execute(
    `SELECT * FROM premium_subscriptions 
     WHERE user_id = ? AND status = 'active' AND end_date >= ? 
     ORDER BY end_date DESC LIMIT 1`,
    [userId, today]
  );
  return subscriptions.length > 0 ? subscriptions[0] : null;
}

// GET /api/premium/status - Vérifier le statut premium
router.get('/status', authenticate, async (req, res) => {
  try {
    const subscription = await isPremium(req.user.userId);
    
    if (subscription) {
      res.json({
        isPremium: true,
        plan: subscription.plan,
        startDate: subscription.start_date,
        endDate: subscription.end_date,
        daysRemaining: Math.max(0, Math.ceil((new Date(subscription.end_date) - new Date()) / (1000 * 60 * 60 * 24)))
      });
    } else {
      res.json({
        isPremium: false,
        plan: null,
        startDate: null,
        endDate: null,
        daysRemaining: 0
      });
    }
  } catch (error) {
    console.error('Premium status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/premium/subscribe - S'abonner (simulation pour l'instant)
router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { plan } = req.body; // 'monthly' ou 'yearly'
    
    if (!plan || !['monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ message: 'Plan must be "monthly" or "yearly"' });
    }
    
    // En production, intégrer avec Stripe/PayPal/etc.
    // Pour l'instant, on simule juste l'abonnement
    
    const startDate = new Date();
    const endDate = new Date();
    
    if (plan === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    
    // Désactiver les anciens abonnements
    await db.pool.execute(
      `UPDATE premium_subscriptions SET status = 'cancelled' 
       WHERE user_id = ? AND status = 'active'`,
      [req.user.userId]
    );
    
    // Créer le nouvel abonnement
    await db.pool.execute(
      `INSERT INTO premium_subscriptions (user_id, plan, start_date, end_date, status) 
       VALUES (?, ?, ?, ?, 'active')`,
      [req.user.userId, plan, startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)]
    );
    
    res.json({
      success: true,
      message: `Abonnement ${plan === 'monthly' ? 'mensuel' : 'annuel'} activé`,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10)
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/premium/cancel - Annuler l'abonnement
router.post('/cancel', authenticate, async (req, res) => {
  try {
    await db.pool.execute(
      `UPDATE premium_subscriptions SET status = 'cancelled' 
       WHERE user_id = ? AND status = 'active'`,
      [req.user.userId]
    );
    
    res.json({
      success: true,
      message: 'Abonnement annulé. Vous gardez l\'accès jusqu\'à la fin de la période payée.'
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
module.exports.isPremium = isPremium;
