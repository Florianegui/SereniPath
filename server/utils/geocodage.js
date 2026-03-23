const axios = require('axios');

// Bounds France métropolitaine (approximatif)
const FRANCE_BOUNDS = {
  minLat: 41.3,
  maxLat: 51.1,
  minLng: -5.1,
  maxLng: 9.6
};

function isInFrance(lat, lng) {
  return lat >= FRANCE_BOUNDS.minLat && lat <= FRANCE_BOUNDS.maxLat &&
         lng >= FRANCE_BOUNDS.minLng && lng <= FRANCE_BOUNDS.maxLng;
}

// Géocodage via Google Geocoding API (prioritaire si clé configurée)
async function geocodeWithGoogle(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const query = address.includes(',') ? address : `${address}, France`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=fr&components=country:FR&key=${apiKey}`;

  try {
    const response = await axios.get(url, { timeout: 10000 });
    if (response.data.status !== 'OK' || !response.data.results?.length) return null;
    const r = response.data.results[0];
    const lat = r.geometry?.location?.lat;
    const lng = r.geometry?.location?.lng;
    if (lat == null || lng == null) return null;
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!isInFrance(latNum, lngNum)) return null;
    return {
      lat: latNum,
      lng: lngNum,
      display_name: r.formatted_address || query
    };
  } catch (err) {
    console.error('Google Geocoding error:', err.message);
    return null;
  }
}

// Géocodage avec Nominatim (OpenStreetMap) - toute la France (fallback)
async function geocodeWithNominatim(address) {
  const query = address.includes(',') ? address : `${address}, France`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=fr`;

  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Zénova/1.0 (contact@zenova.fr)' },
    timeout: 10000
  });

  if (response.data && response.data.length > 0) {
    const result = response.data[0];
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (isInFrance(lat, lng)) {
      return { lat, lng, display_name: result.display_name };
    }
  }
  return null;
}

// Géocodage : Google si clé présente, sinon Nominatim
async function geocodeAddress(address) {
  try {
    const googleResult = await geocodeWithGoogle(address);
    if (googleResult) {
      console.log('Geocoding: Google', address);
      return googleResult;
    }
    const nominatimResult = await geocodeWithNominatim(address);
    if (nominatimResult) {
      console.log('Geocoding: Nominatim', address);
      return nominatimResult;
    }
    throw new Error(`Adresse "${address}" non trouvée en France`);
  } catch (error) {
    console.error('Geocoding error:', error.message, error.response?.data);
    if (error.message.includes('non trouvée')) throw error;
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new Error('Timeout lors de la recherche de l\'adresse. Veuillez réessayer.');
    }
    throw new Error(`Erreur lors de la recherche de l'adresse: ${error.message}`);
  }
}

module.exports = {
  geocodeAddress,
  isInFrance,
  FRANCE_BOUNDS
};
