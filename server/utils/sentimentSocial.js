/**
 * Analyse de sentiment sur données sociales
 * - Avis Google Maps (Place Details API) : vraies données si GOOGLE_MAPS_API_KEY + Places API
 * - Forums : entrées en base (saisie manuelle ou API dédiée)
 */
const axios = require('axios');
const { analyzeText, aggregateSentiment } = require('./serviceSentiment');

const GOOGLE_PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

/**
 * Récupère les avis Google d'un lieu (place_id ou recherche par nom + lat/lng).
 * @param {string} placeId - Google place_id (prioritaire)
 * @param {string} placeName - Nom du lieu pour recherche si pas de place_id
 * @param {number} lat - Latitude (pour find place)
 * @param {number} lng - Longitude (pour find place)
 */
async function getGoogleReviews(placeId, placeName, lat, lng) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { source: 'google', reviews: [], rating: null, sentiment: null, error: 'no_api_key' };
  }

  let pid = placeId;
  if (!pid && placeName && typeof lat === 'number' && typeof lng === 'number') {
    try {
      const findRes = await axios.get(`${GOOGLE_PLACES_BASE}/findplacefromtext/json`, {
        params: {
          key: apiKey,
          input: placeName,
          inputtype: 'textquery',
          fields: 'place_id',
          locationbias: `point:${lat},${lng}`
        },
        timeout: 5000
      });
      const cand = findRes.data?.candidates?.[0];
      pid = cand?.place_id;
    } catch (e) {
      console.warn('[SocialSentiment] Find Place error:', e.message);
      return { source: 'google', reviews: [], rating: null, sentiment: null, error: 'find_place_failed' };
    }
  }

  if (!pid) {
    return { source: 'google', reviews: [], rating: null, sentiment: null, error: 'no_place_id' };
  }

  try {
    const res = await axios.get(`${GOOGLE_PLACES_BASE}/details/json`, {
      params: {
        key: apiKey,
        place_id: pid,
        fields: 'name,rating,user_ratings_total,reviews',
        language: 'fr'
      },
      timeout: 5000
    });
    const d = res.data?.result || {};
    const reviews = (d.reviews || []).map(r => ({
      text: r.text || '',
      rating: r.rating,
      time: r.relative_time_description
    }));
    const texts = reviews.map(r => r.text).filter(Boolean);
    const sentiment = texts.length ? aggregateSentiment(texts) : null;
    return {
      source: 'google',
      place_id: pid,
      placeName: d.name,
      rating: d.rating ?? null,
      user_ratings_total: d.user_ratings_total ?? null,
      reviews,
      sentiment
    };
  } catch (err) {
    console.warn('[SocialSentiment] Place Details error:', err.message);
    return { source: 'google', reviews: [], rating: null, sentiment: null, error: err.message };
  }
}

/**
 * Forums (base de données) : entrées saisies ou importées.
 */
async function getForumMentions(placeName, lat, lng, dbPool) {
  if (!dbPool) {
    return { source: 'forums', mentions: [], sentiment: null };
  }
  try {
    const [rows] = await dbPool.execute(
      `SELECT id, source, place_name, text, sentiment_score, created_at 
       FROM sentiment_analyses 
       WHERE source = 'forum' AND (place_name LIKE ? OR (latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?))
       ORDER BY created_at DESC LIMIT 20`,
      [`%${placeName || ''}%`, (lat || 0) - 0.05, (lat || 0) + 0.05, (lng || 0) - 0.05, (lng || 0) + 0.05]
    );
    const mentions = (rows || []).map((r) => ({
      text: r.text,
      sentiment: { score: r.sentiment_score, label: r.sentiment_score < -0.5 ? 'négatif' : r.sentiment_score > 0.5 ? 'positif' : 'neutre' },
      time: r.created_at
    }));
    const texts = mentions.map((m) => m.text).filter(Boolean);
    const sentiment = texts.length ? aggregateSentiment(texts) : null;
    return { source: 'forums', mentions, sentiment };
  } catch (e) {
    console.warn('[SocialSentiment] Forum fetch error:', e.message);
    return { source: 'forums', mentions: [], sentiment: null, error: e.message };
  }
}

/**
 * Agrège toutes les sources pour un lieu et détecte zones problématiques.
 */
async function getSentimentForPlace(options, dbPool) {
  const { placeId, placeName, lat, lng } = options;

  const [google, forums] = await Promise.all([
    getGoogleReviews(placeId, placeName, lat, lng),
    getForumMentions(placeName, lat, lng, dbPool)
  ]);

  const sources = [google, forums];
  const allScores = sources
    .map((s) => s.sentiment?.score)
    .filter((v) => typeof v === 'number');
  const avgScore = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
  const isProblematic = avgScore < -1;

  // Détection d'événements depuis les forums uniquement
  const eventsDetected = (forums.mentions || []).some((m) =>
    /événement|travaux|incident|manifestation|prudence|alerte|grève|blocage/i.test(m.text || '')
  );

  return {
    placeName: placeName || google.placeName,
    lat,
    lng,
    sources: {
      google: {
        place_id: google.place_id,
        rating: google.rating,
        reviewsCount: google.reviews?.length || 0,
        reviews: google.reviews || [],
        sentiment: google.sentiment,
        realData: !!process.env.GOOGLE_MAPS_API_KEY,
        error: google.error
      },
      forums: { mentionsCount: (forums.mentions || []).length, sentiment: forums.sentiment }
    },
    aggregatedScore: Math.round(avgScore * 10) / 10,
    label: avgScore > 0.5 ? 'positif' : avgScore < -0.5 ? 'négatif' : 'neutre',
    isProblematic,
    eventsDetected
  };
}

module.exports = {
  getGoogleReviews,
  getForumMentions,
  getSentimentForPlace,
  analyzeText,
  aggregateSentiment
};
