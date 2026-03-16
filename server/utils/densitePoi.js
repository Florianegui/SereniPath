const axios = require('axios');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Score de fréquentation (0-100) par type de POI selon l'heure et le jour.
 * hour: 0-23, dayOfWeek: 0=dimanche, 6=samedi
 */
function getDensityForPoiType(poiType, hour, dayOfWeek) {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const h = hour;

  const profiles = {
    restaurant: () => {
      if ((h >= 12 && h <= 14) || (h >= 19 && h <= 21)) return 85;
      if (h >= 11 && h <= 22) return 55;
      return 25;
    },
    bar: () => {
      if (h >= 18 && h <= 23) return 80;
      if (h >= 12 && h <= 24) return 50;
      return 20;
    },
    nightclub: () => {
      if (h >= 23 || h <= 4) return isWeekend ? 95 : 75;
      return 15;
    },
    cinema: () => {
      if (h >= 14 && h <= 22) return 75;
      if (h >= 10 && h <= 23) return 45;
      return 20;
    },
    museum: () => {
      if (h >= 10 && h <= 18) return 70;
      return 15;
    },
    railway_station: () => {
      if ((h >= 7 && h <= 9) || (h >= 17 && h <= 19)) return 90;
      if (h >= 6 && h <= 22) return 55;
      return 30;
    },
    mall: () => {
      if (h >= 14 && h <= 19) return 80;
      if (h >= 10 && h <= 20) return isWeekend ? 70 : 55;
      return 25;
    },
    attraction: () => {
      if (h >= 10 && h <= 18) return isWeekend ? 85 : 60;
      return 30;
    },
    default: () => 50
  };

  const fn = profiles[poiType] || profiles.default;
  return Math.min(100, Math.max(0, fn()));
}

/**
 * Récupère les POIs (restos, bars, boîtes, gares, musées, centres commerciaux...) dans une zone
 * et leur attribue une densité selon l'heure et le jour.
 */
async function getPoiDensityInArea(lat, lng, radiusMeters = 5000, hour = 12, dayOfWeek = 1) {
  // Overpass: bbox autour du point (approx depuis radius en m)
  const delta = radiusMeters / 111320; // ~1 deg lat = 111.32 km
  const minLat = lat - delta;
  const maxLat = lat + delta;
  const minLng = lng - delta / Math.cos(lat * Math.PI / 180);
  const maxLng = lng + delta / Math.cos(lat * Math.PI / 180);

  // Requête Overpass améliorée pour récupérer plus de POIs en France
  const query = `
    [out:json][timeout:45];
    (
      // Restaurants et restauration
      node["amenity"="restaurant"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="fast_food"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="cafe"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="ice_cream"](${minLat},${minLng},${maxLat},${maxLng});
      // Bars et vie nocturne
      node["amenity"="bar"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="pub"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="nightclub"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="biergarten"](${minLat},${minLng},${maxLat},${maxLng});
      // Culture et loisirs
      node["amenity"="cinema"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="theatre"](${minLat},${minLng},${maxLat},${maxLng});
      node["tourism"="museum"](${minLat},${minLng},${maxLat},${maxLng});
      node["tourism"="attraction"](${minLat},${minLng},${maxLat},${maxLng});
      node["tourism"="gallery"](${minLat},${minLng},${maxLat},${maxLng});
      // Transports
      node["railway"="station"](${minLat},${minLng},${maxLat},${maxLng});
      node["public_transport"="station"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="bus_station"](${minLat},${minLng},${maxLat},${maxLng});
      // Shopping
      node["shop"="mall"](${minLat},${minLng},${maxLat},${maxLng});
      node["shop"="department_store"](${minLat},${minLng},${maxLat},${maxLng});
      node["shop"="supermarket"](${minLat},${minLng},${maxLat},${maxLng});
      // Ways (polygones) pour les grands établissements
      way["amenity"="restaurant"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"="fast_food"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"="cafe"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"="bar"](${minLat},${minLng},${maxLat},${maxLng});
      way["tourism"="museum"](${minLat},${minLng},${maxLat},${maxLng});
      way["tourism"="attraction"](${minLat},${minLng},${maxLat},${maxLng});
      way["railway"="station"](${minLat},${minLng},${maxLat},${maxLng});
      way["shop"="mall"](${minLat},${minLng},${maxLat},${maxLng});
      way["shop"="supermarket"](${minLat},${minLng},${maxLat},${maxLng});
    );
    out center 500;
  `;

  try {
    console.log(`[POI Density] Fetching POIs for lat=${lat}, lng=${lng}, radius=${radiusMeters}m, hour=${hour}, day=${dayOfWeek}`);
    const response = await axios.post(OVERPASS_URL, `data=${encodeURIComponent(query)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000 // Timeout augmenté pour grandes villes
    });

    const elements = response.data.elements || [];
    console.log(`[POI Density] Overpass returned ${elements.length} elements`);
    const zones = [];
    const seen = new Set();

    for (const el of elements) {
      let pointLat, pointLng, poiType, name;

      if (el.type === 'node') {
        pointLat = el.lat;
        pointLng = el.lon;
      } else if (el.center) {
        pointLat = el.center.lat;
        pointLng = el.center.lon;
      } else continue;

      const key = `${pointLat.toFixed(5)}_${pointLng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const tags = el.tags || {};
      name = tags.name || tags['name:fr'] || null;

      // Classification des POIs
      if (tags.amenity === 'restaurant' || tags.amenity === 'fast_food') {
        poiType = 'restaurant';
      } else if (tags.amenity === 'cafe' || tags.amenity === 'ice_cream') {
        poiType = 'restaurant'; // Traiter comme restaurant pour la fréquentation
      } else if (tags.amenity === 'bar' || tags.amenity === 'pub' || tags.amenity === 'biergarten') {
        poiType = 'bar';
      } else if (tags.amenity === 'nightclub') {
        poiType = 'nightclub';
      } else if (tags.amenity === 'cinema' || tags.amenity === 'theatre') {
        poiType = 'cinema';
      } else if (tags.tourism === 'museum' || tags.tourism === 'gallery') {
        poiType = 'museum';
      } else if (tags.tourism === 'attraction') {
        poiType = 'attraction';
      } else if (tags.railway === 'station' || tags.public_transport === 'station' || tags.amenity === 'bus_station') {
        poiType = 'railway_station';
      } else if (tags.shop === 'mall' || tags.shop === 'department_store' || tags.shop === 'supermarket') {
        poiType = 'mall';
      } else {
        poiType = 'default';
      }

      const density_score = getDensityForPoiType(poiType, hour, dayOfWeek);
      zones.push({
        id: `poi_${el.type}_${el.id}`,
        name: name || poiType,
        latitude: pointLat,
        longitude: pointLng,
        radius: 150,
        density_score,
        poi_type: poiType
      });
    }

    console.log(`[POI Density] Processed ${zones.length} zones after deduplication`);
    return zones;
  } catch (err) {
    console.error('[POI Density] Overpass error:', err.message);
    if (err.response) {
      console.error('[POI Density] Response status:', err.response.status);
      console.error('[POI Density] Response data:', err.response.data);
    }
    return [];
  }
}

module.exports = {
  getPoiDensityInArea,
  getDensityForPoiType
};
