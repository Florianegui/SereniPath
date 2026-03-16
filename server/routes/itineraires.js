const axios = require('axios');
const express = require('express');
const db = require('../config/baseDonnees');
const authenticate = require('../middleware/authentification');
const { geocodeAddress, isInFrance } = require('../utils/geocodage');
const { generateThreeRouteVariants } = require('../utils/serviceItineraires');
const { updateMultipleZonesDensity } = require('../utils/densiteTempsReel');
const { findRestPointsAround, findRestPointsAlongRoute } = require('../utils/overpass');
const { addPoints, updateStreak, checkAndAwardBadge, POINTS } = require('./gamification');
const anxietyPredictor = require('../utils/ml/predicteurAnxiete');

const router = express.Router();

// Autocomplete d'adresses (Places API) – France uniquement
router.get('/autocomplete', authenticate, async (req, res) => {
  try {
    const q = (req.query.q || req.query.input || '').trim();
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.json({ predictions: [] });
    }
    if (q.length < 2) {
      return res.json({ predictions: [] });
    }
    const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
    const response = await axios.get(url, {
      params: {
        input: q,
        key: apiKey,
        components: 'country:fr',
        language: 'fr',
        types: 'address|establishment|geocode'
      },
      timeout: 5000
    });
    const data = response.data || {};
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn('Places Autocomplete status:', data.status);
      return res.json({ predictions: [] });
    }
    const predictions = (data.predictions || []).map(p => ({
      description: p.description,
      place_id: p.place_id,
      structured_formatting: p.structured_formatting
    }));
    res.json({ predictions });
  } catch (err) {
    console.error('Autocomplete error:', err.message);
    res.status(500).json({ predictions: [] });
  }
});

// Géocodage d'une adresse (Paris uniquement)
router.post('/geocode', authenticate, async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ message: 'Adresse requise' });
    }

    const result = await geocodeAddress(address);
    res.json(result);
  } catch (error) {
    console.error('Geocode error:', error);
    res.status(400).json({ message: error.message || 'Erreur lors de la recherche de l\'adresse' });
  }
});

// Calculate three route variants (peu/moyen/beaucoup de monde)
router.post('/calculate', authenticate, async (req, res) => {
  try {
    console.log('Route calculation request:', { body: req.body, userId: req.user.userId });
    const { startAddress, endAddress, startLat, startLng, endLat, endLng, hour, dayOfWeek } = req.body;

    let startCoords, endCoords;

    // Si des adresses sont fournies, les géocoder
    if (startAddress && endAddress) {
      try {
        console.log('Geocoding addresses:', { startAddress, endAddress });
        startCoords = await geocodeAddress(startAddress);
        console.log('Start coords:', startCoords);
        endCoords = await geocodeAddress(endAddress);
        console.log('End coords:', endCoords);
      } catch (error) {
        console.error('Geocoding error:', error);
        return res.status(400).json({ message: error.message || 'Erreur lors de la géolocalisation des adresses' });
      }
    } else if (startLat && startLng && endLat && endLng) {
      const startLatNum = parseFloat(startLat);
      const startLngNum = parseFloat(startLng);
      const endLatNum = parseFloat(endLat);
      const endLngNum = parseFloat(endLng);
      if (!isInFrance(startLatNum, startLngNum) || !isInFrance(endLatNum, endLngNum)) {
        return res.status(400).json({ message: 'Les trajets doivent être situés en France métropolitaine' });
      }
      startCoords = { lat: startLatNum, lng: startLngNum };
      endCoords = { lat: endLatNum, lng: endLngNum };
    } else {
      return res.status(400).json({ message: 'Adresses ou coordonnées requises' });
    }

    const currentHour = hour !== undefined ? parseInt(hour) : new Date().getHours();
    const currentDay = dayOfWeek !== undefined ? parseInt(dayOfWeek) : new Date().getDay();

    console.log('Fetching zones for hour:', currentHour, 'day:', currentDay);

    // Get all zones
    let zones;
    try {
      [zones] = await db.pool.execute(
        `SELECT 
          z.id,
          z.name,
          z.latitude,
          z.longitude,
          z.radius
         FROM zones z
         ORDER BY z.id`
      );
      console.log('Zones fetched:', zones.length);
      
      // Mettre à jour avec les données en temps réel
      console.log('Updating zones with real-time density data...');
      zones = await updateMultipleZonesDensity(zones, currentHour, currentDay);
      
      // Sauvegarder les données mises à jour dans la base de données (optionnel, pour historique)
      for (const zone of zones) {
        try {
          await db.pool.execute(
            `INSERT INTO density_data (zone_id, hour, day_of_week, density_score, data_source, reliability_score)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               density_score = VALUES(density_score),
               data_source = VALUES(data_source),
               reliability_score = VALUES(reliability_score),
               timestamp = CURRENT_TIMESTAMP`,
            [
              zone.id,
              currentHour,
              currentDay,
              zone.density_score,
              zone.data_source || 'realtime',
              zone.reliability_score || 0.85
            ]
          );
        } catch (saveError) {
          console.error('Error saving density data for zone', zone.id, ':', saveError.message);
        }
      }
      
      console.log('Real-time density data updated for', zones.length, 'zones');
    } catch (dbError) {
      console.error('Database error fetching zones:', dbError);
      // Continuer avec un tableau vide si la base de données échoue
      zones = [];
    }

    const transportMode = req.body.transportMode || 'walking'; // walking | driving | transit | bicycling

    // Générer les 3 variantes d'itinéraires (pied, voiture, transport, vélo)
    console.log('Generating route variants, mode:', transportMode);
    let routes;
    try {
      routes = await generateThreeRouteVariants(
        startCoords,
        endCoords,
        zones,
        currentHour,
        currentDay,
        transportMode
      );
      console.log('Routes generated:', routes.length);
    } catch (routeError) {
      console.error('Route generation error:', routeError);
      throw routeError;
    }

    routes.sort((a, b) => a.avgDensity - b.avgDensity);

    // Prédictions ML d'anxiété pour chaque route
    const routesWithPredictions = await Promise.all(
      routes.map(async (route) => {
        try {
          const pathCoords = route.route && route.route.features && route.route.features[0]
            ? route.route.features[0].geometry.coordinates
            : [];
          
          // Calculer la distance du trajet
          let distance = 0;
          if (pathCoords.length >= 2) {
            for (let i = 1; i < pathCoords.length; i++) {
              const [lng1, lat1] = pathCoords[i - 1];
              const [lng2, lat2] = pathCoords[i];
              const R = 6371;
              const dLat = (lat2 - lat1) * (Math.PI / 180);
              const dLng = (lng2 - lng1) * (Math.PI / 180);
              const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                        Math.sin(dLng / 2) * Math.sin(dLng / 2);
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              distance += R * c;
            }
          } else {
            // Fallback: distance directe
            const R = 6371;
            const dLat = (endCoords.lat - startCoords.lat) * (Math.PI / 180);
            const dLng = (endCoords.lng - startCoords.lng) * (Math.PI / 180);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(startCoords.lat * Math.PI / 180) * Math.cos(endCoords.lat * Math.PI / 180) *
                      Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distance = R * c;
          }

          const prediction = await anxietyPredictor.predictAnxiety(req.user.userId, {
            startLat: startCoords.lat,
            startLng: startCoords.lng,
            endLat: endCoords.lat,
            endLng: endCoords.lng,
            hour: currentHour,
            dayOfWeek: currentDay,
            densityScore: route.avgDensity,
            transportMode: transportMode === 'walking' ? 0 : 
                           transportMode === 'driving' ? 1 :
                           transportMode === 'transit' ? 2 : 3,
            distance: distance
          });

          return {
            ...route,
            mlPrediction: prediction
          };
        } catch (error) {
          console.error('Error predicting anxiety for route:', error);
          return {
            ...route,
            mlPrediction: null
          };
        }
      })
    );

    // Points de repos calmes (Overpass) : autour du milieu du trajet + le long de l'itinéraire recommandé
    let restPoints = [];
    try {
      const recommendedRoute = routes.find(r => r.type === 'calm') || routes[0];
      const coords = recommendedRoute.route && recommendedRoute.route.features && recommendedRoute.route.features[0]
        ? recommendedRoute.route.features[0].geometry.coordinates
        : [];
      const midLat = (startCoords.lat + endCoords.lat) / 2;
      const midLng = (startCoords.lng + endCoords.lng) / 2;
      const [aroundPoints, alongPoints] = await Promise.all([
        findRestPointsAround(midLat, midLng, 800, 15),
        coords.length >= 2 ? findRestPointsAlongRoute(coords, 400, 10) : []
      ]);
      const seen = new Set();
      for (const p of [...aroundPoints, ...alongPoints]) {
        const key = `${p.lat.toFixed(5)}_${p.lng.toFixed(5)}`;
        if (!seen.has(key)) { seen.add(key); restPoints.push(p); }
      }
      restPoints = restPoints.slice(0, 20);
    } catch (e) {
      console.error('Rest points error:', e.message);
    }

    try {
      const recommendedRoute = routes.find(r => r.type === 'calm') || routes[0];
      const pathCoords = recommendedRoute.route && recommendedRoute.route.features && recommendedRoute.route.features[0]
        ? recommendedRoute.route.features[0].geometry.coordinates
        : [];
      // Déterminer le niveau de densité
      const densityScore = recommendedRoute.avgDensity || 0;
      let densityLevel = 'moderate';
      if (densityScore < 30) {
        densityLevel = 'calm';
      } else if (densityScore >= 60) {
        densityLevel = 'elevated';
      }
      
      // Normaliser le transport_type
      const normalizedTransportType = transportMode === 'walking' ? 'walking' :
                                     transportMode === 'driving' ? 'car' :
                                     transportMode === 'transit' ? 'transport' :
                                     transportMode === 'bicycling' ? 'bicycle' : 'walking';
      
      await db.pool.execute(
        'INSERT INTO routes (user_id, start_lat, start_lng, end_lat, end_lng, recommended_path, density_score, transport_type, density_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          req.user.userId,
          startCoords.lat,
          startCoords.lng,
          endCoords.lat,
          endCoords.lng,
          JSON.stringify(pathCoords),
          densityScore,
          normalizedTransportType,
          densityLevel
        ]
      );
      
      // Attribuer des points pour avoir planifié un trajet
      try {
        await addPoints(req.user.userId, POINTS.PLAN_ROUTE, 'Trajet planifié');
        await updateStreak(req.user.userId);
        
        // Si c'est un trajet calme, bonus
        if (recommendedRoute.avgDensity < 30) {
          await addPoints(req.user.userId, POINTS.CALM_ROUTE, 'Trajet calme choisi');
          await checkAndAwardBadge(req.user.userId, 'zen');
        }
        
        // Vérifier le badge "Premier pas"
        await checkAndAwardBadge(req.user.userId, 'first_step');
        
        // Vérifier le badge "Vétéran" (100 trajets)
        const [routeCount] = await db.pool.execute(
          'SELECT COUNT(*) as count FROM routes WHERE user_id = ?',
          [req.user.userId]
        );
        if (routeCount[0].count >= 100) {
          await checkAndAwardBadge(req.user.userId, 'veteran');
        }
      } catch (gamifError) {
        console.error('Gamification error (non-blocking):', gamifError);
      }
    } catch (dbError) {
      console.error('Database error saving route:', dbError);
    }

    res.json({
      routes: routesWithPredictions,
      start: startCoords,
      end: endCoords,
      restPoints,
      transportMode
    });
  } catch (error) {
    console.error('Calculate route error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: error.message || 'Erreur lors du calcul des itinéraires',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get user's route history
router.get('/history', authenticate, async (req, res) => {
  try {
    const [routes] = await db.pool.execute(
      'SELECT * FROM routes WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.userId]
    );

    res.json(routes);
  } catch (error) {
    console.error('Get route history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
