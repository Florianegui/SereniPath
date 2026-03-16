/**
 * API Analyse de sentiment sur données sociales
 * - Zones problématiques (sentiment négatif)
 * - Sentiment autour d'un lieu (Google avis, forums)
 */
const express = require('express');
const db = require('../config/baseDonnees');
const {
  getSentimentForPlace,
  getGoogleReviews,
  analyzeText,
  aggregateSentiment
} = require('../utils/sentimentSocial');

const router = express.Router();

/**
 * GET /api/sentiment/place
 * Query: placeId?, placeName?, lat, lng
 * Retourne le sentiment agrégé (Google avis, forums) pour un lieu.
 */
router.get('/place', async (req, res) => {
  try {
    const placeId = req.query.placeId || null;
    const placeName = (req.query.placeName || '').trim() || null;
    const lat = req.query.lat != null ? parseFloat(req.query.lat) : null;
    const lng = req.query.lng != null ? parseFloat(req.query.lng) : null;

    if (!placeId && !placeName && (lat == null || lng == null)) {
      return res.status(400).json({ message: 'Indiquez placeId, ou placeName avec lat/lng.' });
    }

    const result = await getSentimentForPlace(
      { placeId, placeName, lat, lng },
      db.pool
    );
    res.json(result);
  } catch (err) {
    console.error('Sentiment place error:', err);
    res.status(500).json({ message: 'Erreur lors de l\'analyse du lieu.' });
  }
});

/**
 * POST /api/sentiment/analyze
 * Body: { text: string } ou { texts: string[] }
 * Analyse le sentiment d'un ou plusieurs textes (ex: avis, posts).
 */
router.post('/analyze', async (req, res) => {
  try {
    const { text, texts } = req.body || {};
    if (texts && Array.isArray(texts)) {
      const result = aggregateSentiment(texts);
      return res.json(result);
    }
    if (text && typeof text === 'string') {
      const result = analyzeText(text);
      return res.json(result);
    }
    return res.status(400).json({ message: 'Envoie "text" ou "texts" (tableau).' });
  } catch (err) {
    console.error('Sentiment analyze error:', err);
    res.status(500).json({ message: 'Erreur lors de l\'analyse.' });
  }
});

/**
 * GET /api/sentiment/problematic-zones
 * Query: lat, lng, radius (km, défaut 10)
 * Liste les zones avec sentiment négatif (stockées ou proches).
 */
router.get('/problematic-zones', async (req, res) => {
  try {
    const lat = req.query.lat != null ? parseFloat(req.query.lat) : null;
    const lng = req.query.lng != null ? parseFloat(req.query.lng) : null;
    const radiusKm = Math.min(parseFloat(req.query.radius) || 10, 50);
    const delta = radiusKm / 111; // approx deg

    let query = 'SELECT id, name, latitude, longitude, negative_mentions, last_mentioned_at, created_at FROM problematic_zones';
    const params = [];
    if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      query += ' WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?';
      params.push(lat - delta, lat + delta, lng - delta, lng + delta);
    }
    query += ' ORDER BY negative_mentions DESC, last_mentioned_at DESC LIMIT 50';

    const [rows] = await db.pool.execute(query, params);
    res.json({ zones: rows || [] });
  } catch (err) {
    console.error('Problematic zones error:', err);
    res.status(500).json({ message: 'Erreur lors du chargement des zones.' });
  }
});

/**
 * GET /api/sentiment/sources
 * Détail par source pour un lieu (Google avis, forums).
 * Query: placeName, lat, lng
 */
router.get('/sources', async (req, res) => {
  try {
    const placeName = (req.query.placeName || '').trim() || 'Lieu';
    const lat = req.query.lat != null ? parseFloat(req.query.lat) : 48.8566;
    const lng = req.query.lng != null ? parseFloat(req.query.lng) : 2.3522;

    const google = await getGoogleReviews(null, placeName, lat, lng);

    res.json({
      google: {
        rating: google.rating,
        reviewsCount: google.reviews?.length || 0,
        sentiment: google.sentiment,
        error: google.error,
        realData: !!process.env.GOOGLE_MAPS_API_KEY
      }
    });
  } catch (err) {
    console.error('Sentiment sources error:', err);
    res.status(500).json({ message: 'Erreur lors du chargement des sources.' });
  }
});

/**
 * POST /api/sentiment/forum
 * Enregistre un avis/mention forum (pour stub et tests).
 * Body: placeName, text, lat?, lng?
 */
router.post('/forum', async (req, res) => {
  try {
    const { placeName, text, lat, lng } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ message: 'Champ "text" requis.' });
    }
    const sentiment = analyzeText(text);
    await db.pool.execute(
      `INSERT INTO sentiment_analyses (place_name, source, text, sentiment_score, latitude, longitude) VALUES (?, 'forum', ?, ?, ?, ?, ?)`,
      [placeName || null, text, sentiment.score, lat || null, lng || null]
    );
    if (sentiment.score < -1 && (lat != null && lng != null)) {
      await db.pool.execute(
        `INSERT INTO problematic_zones (name, latitude, longitude, negative_mentions, last_mentioned_at)
         VALUES (?, ?, ?, 1, NOW())`,
        [placeName || 'Zone', lat, lng]
      );
    }
    res.json({ saved: true, sentiment });
  } catch (err) {
    console.error('Sentiment forum post error:', err);
    res.status(500).json({ message: 'Erreur lors de l\'enregistrement.' });
  }
});

module.exports = router;
