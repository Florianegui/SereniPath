const express = require('express');
const db = require('../config/baseDonnees');
const authenticate = require('../middleware/authentification');
const anxietyPredictor = require('../utils/ml/predicteurAnxiete');
const dataPreprocessor = require('../utils/ml/preprocesseurDonnees');
const weatherService = require('../utils/ml/serviceMeteo');

const router = express.Router();

/**
 * POST /api/ml/train
 * Entraîne le modèle ML pour l'utilisateur connecté
 */
router.post('/train', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const epochs = parseInt(req.body.epochs) || 50;

    const result = await anxietyPredictor.trainRegressionModel(userId, epochs);
    
    res.json({
      success: result.success,
      message: result.message || 'Modèle entraîné avec succès',
      epochs: result.epochs,
      dataPoints: result.dataPoints,
      finalLoss: result.finalLoss,
      finalMae: result.finalMae
    });
  } catch (error) {
    console.error('ML training error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur lors de l\'entraînement du modèle',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/ml/predict
 * Prédit le niveau d'anxiété pour un trajet donné
 */
router.post('/predict', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      startLat,
      startLng,
      endLat,
      endLng,
      hour,
      dayOfWeek,
      densityScore,
      transportMode,
      distance
    } = req.body;

    if (!startLat || !startLng || !endLat || !endLng) {
      return res.status(400).json({ 
        success: false,
        message: 'Coordonnées de départ et d\'arrivée requises' 
      });
    }

    // Calculer la distance si non fournie
    let calculatedDistance = distance;
    if (!calculatedDistance) {
      const R = 6371; // Rayon de la Terre en km
      const toRad = (degrees) => degrees * (Math.PI / 180);
      const dLat = toRad(endLat - startLat);
      const dLng = toRad(endLng - startLng);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(toRad(startLat)) * Math.cos(toRad(endLat)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      calculatedDistance = R * c;
    }

    const routeData = {
      startLat: parseFloat(startLat),
      startLng: parseFloat(startLng),
      endLat: parseFloat(endLat),
      endLng: parseFloat(endLng),
      hour: hour !== undefined ? parseInt(hour) : new Date().getHours(),
      dayOfWeek: dayOfWeek !== undefined ? parseInt(dayOfWeek) : new Date().getDay(),
      densityScore: densityScore !== undefined ? parseFloat(densityScore) : 50,
      transportMode: transportMode || 0,
      distance: calculatedDistance
    };

    const prediction = await anxietyPredictor.predictAnxiety(userId, routeData);

    // Sauvegarder la prédiction dans la base de données
    try {
      await db.pool.execute(
        `INSERT INTO ml_predictions 
         (user_id, start_lat, start_lng, end_lat, end_lng, predicted_anxiety_level, confidence, factors, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          userId,
          routeData.startLat,
          routeData.startLng,
          routeData.endLat,
          routeData.endLng,
          prediction.anxietyLevel,
          prediction.confidence,
          JSON.stringify(prediction.factors)
        ]
      );
    } catch (dbError) {
      console.error('Error saving prediction to database:', dbError);
      // Ne pas bloquer la réponse si l'insertion échoue
    }

    res.json({
      success: true,
      prediction: {
        anxietyLevel: prediction.anxietyLevel,
        anxietyMood: prediction.anxietyMood,
        confidence: prediction.confidence,
        factors: prediction.factors,
        recommendations: generateRecommendations(prediction)
      }
    });
  } catch (error) {
    console.error('ML prediction error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur lors de la prédiction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/ml/classify-zone
 * Classifie une zone selon son niveau de risque
 */
router.post('/classify-zone', authenticate, async (req, res) => {
  try {
    const {
      lat,
      lng,
      densityScore,
      hour,
      dayOfWeek
    } = req.body;

    if (lat === undefined || lng === undefined || densityScore === undefined) {
      return res.status(400).json({ 
        success: false,
        message: 'Latitude, longitude et densité requises' 
      });
    }

    const weather = await weatherService.getWeather(parseFloat(lat), parseFloat(lng));

    const zoneData = {
      densityScore: parseFloat(densityScore),
      hour: hour !== undefined ? parseInt(hour) : new Date().getHours(),
      dayOfWeek: dayOfWeek !== undefined ? parseInt(dayOfWeek) : new Date().getDay(),
      temperature: weather.temperature,
      humidity: weather.humidity,
      visibility: weather.visibility,
      weatherCode: weather.weatherCode,
      isRainy: weather.isRainy
    };

    const classification = await anxietyPredictor.classifyZoneRisk(zoneData);

    res.json({
      success: true,
      classification: {
        riskLevel: classification.riskLevel,
        confidence: classification.confidence,
        probabilities: classification.probabilities,
        recommendations: generateZoneRecommendations(classification)
      }
    });
  } catch (error) {
    console.error('Zone classification error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur lors de la classification de la zone',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/ml/clusters
 * Récupère les clusters d'utilisateurs similaires
 */
router.get('/clusters', authenticate, async (req, res) => {
  try {
    const k = parseInt(req.query.k) || 3;
    const clusters = await anxietyPredictor.clusterUsers(k);

    res.json({
      success: true,
      clusters: clusters.clusters || [],
      userAssignments: clusters.userAssignments || [],
      message: clusters.message
    });
  } catch (error) {
    console.error('Clustering error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur lors du clustering',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/ml/training-data
 * Récupère les données d'entraînement de l'utilisateur
 */
router.get('/training-data', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const data = await dataPreprocessor.getTrainingData(userId);

    res.json({
      success: true,
      dataPoints: data.length,
      data: data.slice(0, 100) // Limiter à 100 points pour la réponse
    });
  } catch (error) {
    console.error('Training data error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur lors de la récupération des données',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Génère des recommandations basées sur la prédiction d'anxiété
 */
function generateRecommendations(prediction) {
  const recommendations = [];

  if (prediction.anxietyLevel >= 4) {
    recommendations.push({
      type: 'high_anxiety',
      message: 'Ce trajet pourrait être stressant. Considérez une alternative plus calme.',
      actions: [
        'Choisissez un itinéraire avec moins de densité',
        'Évitez les heures de pointe',
        'Prévoyez des pauses le long du trajet'
      ]
    });
  } else if (prediction.anxietyLevel >= 3) {
    recommendations.push({
      type: 'moderate_anxiety',
      message: 'Ce trajet présente quelques défis. Restez attentif à votre bien-être.',
      actions: [
        'Utilisez les exercices de respiration si nécessaire',
        'Prévoyez des points de repos'
      ]
    });
  } else {
    recommendations.push({
      type: 'low_anxiety',
      message: 'Ce trajet devrait être serein. Profitez de votre déplacement !',
      actions: []
    });
  }

  // Ajouter des recommandations basées sur les facteurs
  prediction.factors.forEach(factor => {
    if (factor.impact === 'high') {
      recommendations.push({
        type: 'factor_based',
        message: `Facteur important détecté : ${factor.factor}`,
        actions: [`Évitez ce facteur si possible`]
      });
    }
  });

  return recommendations;
}

/**
 * Génère des recommandations pour une zone
 */
function generateZoneRecommendations(classification) {
  const recommendations = [];

  if (classification.riskLevel === 'risky') {
    recommendations.push({
      type: 'avoid',
      message: 'Cette zone présente un risque élevé d\'anxiété',
      actions: ['Évitez cette zone si possible', 'Choisissez un itinéraire alternatif']
    });
  } else if (classification.riskLevel === 'moderate') {
    recommendations.push({
      type: 'caution',
      message: 'Cette zone nécessite une attention modérée',
      actions: ['Soyez attentif à votre bien-être', 'Prévoyez des pauses si nécessaire']
    });
  } else {
    recommendations.push({
      type: 'safe',
      message: 'Cette zone est généralement calme',
      actions: []
    });
  }

  return recommendations;
}

module.exports = router;
