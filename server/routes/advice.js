const express = require('express');
const db = require('../config/database');
const authenticate = require('../middleware/auth');
const { updateMultipleZonesDensity } = require('../utils/realTimeDensity');
const { getPoiDensityInArea } = require('../utils/poiDensity');

const router = express.Router();

// Get personalized advice for user (optionally based on city POI density when lat/lng provided)
router.get('/', authenticate, async (req, res) => {
  try {
    const { hour, dayOfWeek, lat, lng, radius } = req.query;
    const currentHour = hour !== undefined ? parseInt(hour) : new Date().getHours();
    const currentDay = dayOfWeek !== undefined ? parseInt(dayOfWeek) : new Date().getDay();
    const centerLat = lat != null ? parseFloat(lat) : null;
    const centerLng = lng != null ? parseFloat(lng) : null;
    const radiusM = radius != null ? parseInt(radius, 10) : 5000;

    // Get user preferences
    const [prefs] = await db.pool.execute(
      'SELECT * FROM user_preferences WHERE user_id = ?',
      [req.user.userId]
    );

    let densityData = [];
    let poiBased = false;

    // Si une ville est sélectionnée (lat/lng), utiliser les POIs pour des conseils basés sur la densité réelle
    if (centerLat != null && centerLng != null && !isNaN(centerLat) && !isNaN(centerLng)) {
      const pois = await getPoiDensityInArea(centerLat, centerLng, radiusM, currentHour, currentDay);
      densityData = pois.map(p => ({
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        density_score: p.density_score,
        poi_type: p.poi_type,
        reliability_score: 0.8
      }));
      poiBased = true;
    }

    // Sinon utiliser les zones en base (Paris / zones prédéfinies)
    if (densityData.length === 0) {
      const [zones] = await db.pool.execute(
        `SELECT z.id, z.name, z.latitude, z.longitude, z.radius FROM zones z ORDER BY z.id`
      );
      const zonesWithDensity = await updateMultipleZonesDensity(zones, currentHour, currentDay);
      densityData = zonesWithDensity.map(zone => ({
        name: zone.name,
        latitude: zone.latitude,
        longitude: zone.longitude,
        density_score: zone.density_score,
        reliability_score: zone.reliability_score || 0.85
      }));
    }

    const advice = generateAdvice(currentHour, currentDay, densityData, prefs[0] || {}, poiBased);

    res.json(advice);
  } catch (error) {
    console.error('Get advice error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

function generateAdvice(hour, dayOfWeek, densityData, preferences, poiBased) {
  const advice = {
    general: [],
    zones: [],
    timing: [],
    tips: []
  };

  // Conseils temporels basés sur l'heure et (en mode POI) sur les types de lieux les plus fréquentés
  const isRushMorning = hour >= 7 && hour <= 9;
  const isRushEvening = hour >= 17 && hour <= 19;
  const isQuietPeriod = hour >= 10 && hour <= 16;

  if (poiBased && densityData.length > 0) {
    // Résumer les types de POIs les plus denses à cette heure
    const byType = {};
    densityData.forEach(d => {
      const t = d.poi_type || 'default';
      if (!byType[t]) byType[t] = { count: 0, maxScore: 0 };
      byType[t].count++;
      byType[t].maxScore = Math.max(byType[t].maxScore, parseFloat(d.density_score));
    });
    const busyTypes = Object.entries(byType)
      .filter(([, v]) => v.maxScore >= 60)
      .sort((a, b) => b[1].maxScore - a[1].maxScore)
      .slice(0, 3)
      .map(([t]) => t);

    const typeLabels = {
      restaurant: 'restaurants',
      bar: 'bars',
      nightclub: 'boîtes de nuit',
      cinema: 'cinémas',
      museum: 'musées',
      railway_station: 'gares',
      mall: 'centres commerciaux',
      attraction: 'attractions'
    };
    const busyLabel = busyTypes.map(t => typeLabels[t] || t).join(', ');

    if (isRushMorning) {
      advice.timing.push({
        type: 'warning',
        message: 'Heure de pointe matinale - densité élevée attendue',
        recommendation: busyLabel ? `Forte affluence notamment: ${busyLabel}. Déplacez-vous après 10h si possible.` : 'Si possible, déplacez-vous après 10h pour éviter la foule'
      });
    } else if (isRushEvening) {
      advice.timing.push({
        type: 'warning',
        message: 'Heure de pointe du soir - densité élevée attendue',
        recommendation: busyLabel ? `Envisagez de partir avant 17h ou après 19h30. Lieux très fréquentés: ${busyLabel}.` : 'Envisagez de partir avant 17h ou après 19h30'
      });
    } else if (isQuietPeriod) {
      advice.timing.push({
        type: 'success',
        message: 'Période plutôt calme pour beaucoup de lieux',
        recommendation: busyLabel ? `Quelques lieux encore fréquentés (${busyLabel}). Idéal pour musées et déplacements.` : 'C\'est un moment idéal pour vos déplacements'
      });
    } else if (busyLabel) {
      advice.timing.push({
        type: 'info',
        message: `À cette heure, forte affluence possible: ${busyLabel}`,
        recommendation: 'Privilégiez les itinéraires qui évitent ces zones'
      });
    }
  } else {
    // Comportement classique (zones globales)
    if (isRushMorning) {
      advice.timing.push({
        type: 'warning',
        message: 'Heure de pointe matinale - densité élevée attendue',
        recommendation: 'Si possible, déplacez-vous après 10h pour éviter la foule'
      });
    } else if (isRushEvening) {
      advice.timing.push({
        type: 'warning',
        message: 'Heure de pointe du soir - densité élevée attendue',
        recommendation: 'Envisagez de partir avant 17h ou après 19h30'
      });
    } else if (isQuietPeriod) {
      advice.timing.push({
        type: 'success',
        message: 'Période calme - bon moment pour se déplacer',
        recommendation: 'C\'est un moment idéal pour vos déplacements'
      });
    }
  }

  // Jour
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    advice.general.push({
      type: 'info',
      message: 'Jour de semaine - activité normale',
      recommendation: 'Les zones commerciales et gares peuvent être plus fréquentées'
    });
  } else {
    advice.general.push({
      type: 'success',
      message: 'Weekend - loisirs et sorties',
      recommendation: 'Restaurants, bars et centres commerciaux peuvent être très fréquentés en journée'
    });
  }

  // Zones / POIs à éviter et recommandés, basés sur les données de densité
  if (densityData.length > 0) {
    const sortedZones = [...densityData].sort((a, b) =>
      parseFloat(a.density_score) - parseFloat(b.density_score)
    );

    const lowDensityZones = sortedZones
      .filter(z => parseFloat(z.density_score) < 40)
      .slice(0, 5);

    const lowDensityNames = new Set(lowDensityZones.map(z => z.name));
    const highDensityZones = sortedZones
      .filter(z => {
        const density = parseFloat(z.density_score);
        return density > 60 && !lowDensityNames.has(z.name);
      })
      .slice(-5)
      .reverse();

    if (lowDensityZones.length > 0) {
      const names = lowDensityZones.map(z => z.name || z.poi_type).filter(Boolean);
      advice.zones.push({
        type: 'success',
        message: poiBased ? `Lieux ou zones calmes: ${names.slice(0, 5).join(', ')}` : `Zones calmes recommandées: ${names.join(', ')}`,
        zones: lowDensityZones
      });
    }

    if (highDensityZones.length > 0) {
      const names = highDensityZones.map(z => z.name || z.poi_type).filter(Boolean);
      advice.zones.push({
        type: 'warning',
        message: poiBased ? `Lieux ou zones à éviter (forte affluence): ${names.slice(0, 5).join(', ')}` : `Zones à éviter: ${names.join(', ')}`,
        zones: highDensityZones
      });
    }
  }

  // General tips
  advice.tips = [
    {
      type: 'tip',
      message: 'Planifiez votre trajet à l\'avance pour éviter les zones à forte densité',
      icon: '🗺️'
    },
    {
      type: 'tip',
      message: 'Utilisez les heures creuses (10h-16h) pour vos déplacements',
      icon: '⏰'
    },
    {
      type: 'tip',
      message: 'Préférez les itinéraires alternatifs même s\'ils sont légèrement plus longs',
      icon: '🛤️'
    },
    {
      type: 'tip',
      message: 'Restez informé des événements qui pourraient augmenter la densité',
      icon: '📢'
    }
  ];

  return advice;
}

module.exports = router;
