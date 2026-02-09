const axios = require('axios');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Trouve des points de repos calmes autour d'un point (parcs, bancs, fontaines, espaces verts)
 * Utilise l'API Overpass (OpenStreetMap) - https://overpass-turbo.eu/
 */
async function findRestPointsAround(lat, lng, radiusMeters = 500, limit = 20) {
  // Overpass "around" : rayon en mètres
  const query = `
    [out:json][timeout:25];
    (
      node["leisure"="park"](around:${radiusMeters},${lat},${lng});
      node["leisure"="garden"](around:${radiusMeters},${lat},${lng});
      node["natural"="wood"](around:${radiusMeters},${lat},${lng});
      node["amenity"="bench"](around:${radiusMeters},${lat},${lng});
      node["amenity"="drinking_water"](around:${radiusMeters},${lat},${lng});
      way["leisure"="park"](around:${radiusMeters},${lat},${lng});
      way["leisure"="garden"](around:${radiusMeters},${lat},${lng});
    );
    out center ${limit};
  `;

  try {
    const response = await axios.post(OVERPASS_URL, `data=${encodeURIComponent(query)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });

    const elements = response.data.elements || [];
    const restPoints = [];

    for (const el of elements) {
      let pointLat, pointLng, name, type, calmScore;
      if (el.type === 'node') {
        pointLat = el.lat;
        pointLng = el.lon;
      } else if (el.center) {
        pointLat = el.center.lat;
        pointLng = el.center.lon;
      } else continue;

      const tags = el.tags || {};
      name = tags.name || tags['name:fr'] || null;
      if (el.type === 'way' && !name) {
        if (tags.leisure === 'park') name = 'Parc';
        else if (tags.leisure === 'garden') name = 'Jardin';
      }
      if (tags.leisure === 'park' || tags.natural === 'wood') {
        type = 'park';
        calmScore = 90;
      } else if (tags.leisure === 'garden') {
        type = 'garden';
        calmScore = 85;
      } else if (tags.amenity === 'bench') {
        type = 'bench';
        calmScore = 75;
      } else if (tags.amenity === 'drinking_water') {
        type = 'drinking_water';
        calmScore = 80;
      } else {
        type = 'quiet_area';
        calmScore = 70;
      }

      restPoints.push({
        id: el.id,
        lat: pointLat,
        lng: pointLng,
        name: name || (type === 'park' ? 'Parc' : type === 'bench' ? 'Banc' : 'Point calme'),
        type,
        calmScore,
        tags
      });
    }

    // Trier par score de calme (plus calme en premier)
    restPoints.sort((a, b) => b.calmScore - a.calmScore);
    return restPoints.slice(0, limit);
  } catch (error) {
    console.error('Overpass API error:', error.message);
    return [];
  }
}

/**
 * Points de repos le long d'un itinéraire (segments)
 */
async function findRestPointsAlongRoute(coordinates, radiusMeters = 300, maxPoints = 10) {
  if (!coordinates || coordinates.length < 2) return [];
  const results = new Map();
  const step = Math.max(1, Math.floor(coordinates.length / 5));
  for (let i = 0; i < coordinates.length; i += step) {
    const [lng, lat] = coordinates[i];
    const points = await findRestPointsAround(lat, lng, radiusMeters, 3);
    points.forEach(p => results.set(`${p.lat.toFixed(5)}_${p.lng.toFixed(5)}`, p));
    if (results.size >= maxPoints) break;
  }
  return Array.from(results.values()).slice(0, maxPoints);
}

module.exports = {
  findRestPointsAround,
  findRestPointsAlongRoute
};
