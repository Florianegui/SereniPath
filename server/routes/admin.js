const express = require('express');
const fs = require('fs');
const path = require('path');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Email autorisé pour l'accès admin (remplacer par ton email)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'floriane0602@gmail.com';

// Middleware pour vérifier si l'utilisateur est admin
const isAdmin = (req, res, next) => {
  if (!req.user || req.user.email !== ADMIN_EMAIL) {
    return res.status(403).json({ message: 'Accès refusé. Réservé aux administrateurs.' });
  }
  next();
};

// GET /api/admin/anxiety-data - Récupérer les données scrapées
router.get('/anxiety-data', authenticate, isAdmin, async (req, res) => {
  try {
    // Chemin depuis server/routes vers data/ à la racine du projet
    // __dirname = server/routes, donc .. = server, .. = racine
    const dataPath = path.resolve(__dirname, '..', '..', 'data', 'anxiety-stats', 'anxiety-data.json');
    
    console.log('[Admin] User email:', req.user?.email);
    console.log('[Admin] Looking for file at:', dataPath);
    console.log('[Admin] File exists:', fs.existsSync(dataPath));
    
    if (!fs.existsSync(dataPath)) {
      console.log('[Admin] File not found!');
      return res.status(404).json({ message: 'Aucune donnée disponible. Exécutez le script de scraping d\'abord.' });
    }

    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const data = JSON.parse(rawData);

    res.json(data);
  } catch (error) {
    console.error('Error reading anxiety data:', error);
    res.status(500).json({ message: 'Erreur lors de la lecture des données' });
  }
});

// GET /api/admin/anxiety-data/stats - Statistiques résumées
router.get('/anxiety-data/stats', authenticate, isAdmin, async (req, res) => {
  try {
    // Chemin depuis server/routes vers data/ à la racine du projet
    const dataPath = path.resolve(__dirname, '..', '..', 'data', 'anxiety-stats', 'anxiety-data.json');
    
    if (!fs.existsSync(dataPath)) {
      return res.status(404).json({ message: 'Aucune donnée disponible' });
    }

    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const data = JSON.parse(rawData);

    // Calculer des statistiques résumées
    const stats = {
      lastScraped: data.scrapedAt,
      sourcesCount: Object.keys(data.sources || {}).length,
      regionsCount: data.sources?.insee?.regions?.length || 0,
      hourlyDataPoints: data.sources?.transports?.hourlyAffluence?.length || 0,
      prevalence: data.sources?.santePublique?.prevalence || null
    };

    res.json(stats);
  } catch (error) {
    console.error('Error reading anxiety stats:', error);
    res.status(500).json({ message: 'Erreur lors de la lecture des statistiques' });
  }
});

module.exports = router;
