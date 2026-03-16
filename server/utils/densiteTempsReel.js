const axios = require('axios');

// Service pour récupérer des données réelles de densité de population à Paris
// Combine plusieurs sources : stations de transport, points d'intérêt, patterns temporels

// Cache pour éviter trop de requêtes API
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Récupérer les stations de métro/RER proches d'un point
async function getNearbyStations(lat, lng, radius = 500) {
  try {
    // Utiliser l'API Overpass d'OpenStreetMap pour trouver les stations de métro
    const query = `
      [out:json][timeout:25];
      (
        node["railway"="station"]["network"="RATP"](around:${radius},${lat},${lng});
        node["public_transport"="station"]["network"="RATP"](around:${radius},${lat},${lng});
        node["station"="subway"](around:${radius},${lat},${lng});
      );
      out body;
    `;
    
    const response = await axios.post('https://overpass-api.de/api/interpreter', query, {
      headers: {
        'Content-Type': 'text/plain'
      },
      timeout: 10000
    });

    return response.data.elements || [];
  } catch (error) {
    console.error('Error fetching nearby stations:', error.message);
    return [];
  }
}

// Récupérer les points d'intérêt touristiques proches
async function getNearbyPOIs(lat, lng, radius = 500) {
  try {
    const query = `
      [out:json][timeout:25];
      (
        node["tourism"](around:${radius},${lat},${lng});
        node["amenity"="restaurant"](around:${radius},${lat},${lng});
        node["amenity"="cafe"](around:${radius},${lat},${lng});
        node["shop"](around:${radius},${lat},${lng});
      );
      out body;
    `;
    
    const response = await axios.post('https://overpass-api.de/api/interpreter', query, {
      headers: {
        'Content-Type': 'text/plain'
      },
      timeout: 10000
    });

    return response.data.elements || [];
  } catch (error) {
    console.error('Error fetching nearby POIs:', error.message);
    return [];
  }
}

// Calculer la densité basée sur plusieurs facteurs réels
async function calculateRealTimeDensity(lat, lng, hour, dayOfWeek) {
  const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}_${hour}_${dayOfWeek}`;
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.density;
  }

  try {
    // Facteur 1: Proximité des stations de transport (30% du score)
    const stations = await getNearbyStations(lat, lng, 1000);
    const stationDensity = Math.min(100, stations.length * 15); // 15 points par station, max 100
    
    // Facteur 2: Points d'intérêt touristiques (20% du score)
    const pois = await getNearbyPOIs(lat, lng, 500);
    const poiDensity = Math.min(50, pois.length * 3); // 3 points par POI, max 50
    
    // Facteur 3: Patterns temporels basés sur les heures de pointe (25% du score)
    let timePatternDensity = 20; // Base
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    
    // Heures de pointe matin (7h-9h)
    if (hour >= 7 && hour <= 9 && isWeekday) {
      timePatternDensity += 40;
    }
    // Heures de pointe soir (17h-19h)
    else if (hour >= 17 && hour <= 19 && isWeekday) {
      timePatternDensity += 40;
    }
    // Pause déjeuner (12h-14h)
    else if (hour >= 12 && hour <= 14 && isWeekday) {
      timePatternDensity += 25;
    }
    // Soirée (20h-22h)
    else if (hour >= 20 && hour <= 22) {
      timePatternDensity += 20;
    }
    // Nuit (23h-6h)
    else if (hour >= 23 || hour <= 6) {
      timePatternDensity = 10;
    }
    
    // Facteur 4: Zone centrale de Paris (25% du score)
    // Les zones très centrales (1er, 2e, 3e, 4e arrondissements) sont plus fréquentées
    let centralZoneDensity = 0;
    const distanceFromCenter = Math.sqrt(
      Math.pow((lat - 48.8566) * 111, 2) + 
      Math.pow((lng - 2.3522) * 111 * Math.cos(lat * Math.PI / 180), 2)
    ) * 1000; // Distance en mètres
    
    if (distanceFromCenter < 2000) {
      centralZoneDensity = 50 - (distanceFromCenter / 2000) * 30; // 50 à 20 points
    }
    
    // Combiner tous les facteurs avec pondération
    const totalDensity = 
      (stationDensity * 0.30) +
      (poiDensity * 0.20) +
      (timePatternDensity * 0.25) +
      (centralZoneDensity * 0.25);
    
    const finalDensity = Math.min(100, Math.max(0, totalDensity));
    
    // Mettre en cache
    cache.set(cacheKey, {
      density: finalDensity,
      timestamp: Date.now()
    });
    
    return finalDensity;
  } catch (error) {
    console.error('Error calculating real-time density:', error);
    // Retourner une densité par défaut basée sur les patterns temporels
    return getDefaultDensity(hour, dayOfWeek);
  }
}

// Densité par défaut basée uniquement sur les patterns temporels
function getDefaultDensity(hour, dayOfWeek) {
  let density = 30;
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  
  if (hour >= 7 && hour <= 9 && isWeekday) {
    density = 75;
  } else if (hour >= 17 && hour <= 19 && isWeekday) {
    density = 80;
  } else if (hour >= 12 && hour <= 14 && isWeekday) {
    density = 60;
  } else if (hour >= 20 && hour <= 22) {
    density = 50;
  } else if (hour >= 23 || hour <= 6) {
    density = 15;
  }
  
  return density;
}

// Mettre à jour la densité pour une zone
async function updateZoneDensity(zoneId, lat, lng, hour, dayOfWeek) {
  try {
    const density = await calculateRealTimeDensity(lat, lng, hour, dayOfWeek);
    
    // La densité sera sauvegardée dans la base de données par le route handler
    return {
      density_score: density,
      reliability_score: 0.85, // Bonne fiabilité avec données réelles
      data_source: 'realtime'
    };
  } catch (error) {
    console.error('Error updating zone density:', error);
    return {
      density_score: getDefaultDensity(hour, dayOfWeek),
      reliability_score: 0.5,
      data_source: 'fallback'
    };
  }
}

// Calculer la densité pour plusieurs zones en parallèle
async function updateMultipleZonesDensity(zones, hour, dayOfWeek) {
  const promises = zones.map(zone => 
    updateZoneDensity(zone.id, zone.latitude, zone.longitude, hour, dayOfWeek)
      .then(result => ({
        ...zone,
        density_score: result.density_score,
        reliability_score: result.reliability_score,
        data_source: result.data_source
      }))
  );
  
  return Promise.all(promises);
}

module.exports = {
  calculateRealTimeDensity,
  updateZoneDensity,
  updateMultipleZonesDensity,
  getDefaultDensity
};
