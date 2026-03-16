const axios = require('axios');

/**
 * Service pour récupérer les conditions météorologiques
 * Utilise OpenWeatherMap API (gratuite jusqu'à 1000 appels/jour)
 */
class WeatherService {
  constructor() {
    this.apiKey = process.env.OPENWEATHER_API_KEY || '';
    this.baseUrl = 'https://api.openweathermap.org/data/2.5';
    this.cache = new Map();
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Récupère les conditions météo pour une position géographique
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {Promise<Object>} Données météo normalisées
   */
  async getWeather(lat, lng) {
    const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      if (!this.apiKey) {
        // Retourner des données par défaut si pas d'API key
        return this.getDefaultWeather();
      }

      const response = await axios.get(`${this.baseUrl}/weather`, {
        params: {
          lat,
          lon: lng,
          appid: this.apiKey,
          units: 'metric',
          lang: 'fr'
        },
        timeout: 5000
      });

      const weather = this.normalizeWeatherData(response.data);
      this.cache.set(cacheKey, { data: weather, timestamp: Date.now() });
      return weather;
    } catch (error) {
      console.error('Weather API error:', error.message);
      return this.getDefaultWeather();
    }
  }

  /**
   * Normalise les données météo pour le modèle ML
   */
  normalizeWeatherData(data) {
    return {
      temperature: data.main?.temp || 15,
      humidity: data.main?.humidity || 60,
      pressure: data.main?.pressure || 1013,
      visibility: (data.visibility || 10000) / 1000, // en km
      windSpeed: data.wind?.speed || 0,
      windDirection: data.wind?.deg || 0,
      cloudiness: data.clouds?.all || 0,
      weatherCode: this.getWeatherCode(data.weather?.[0]?.main || 'Clear'),
      isRainy: (data.weather?.[0]?.main || '').toLowerCase().includes('rain'),
      isSnowy: (data.weather?.[0]?.main || '').toLowerCase().includes('snow'),
      isCloudy: (data.clouds?.all || 0) > 50,
      isClear: (data.weather?.[0]?.main || '').toLowerCase() === 'clear'
    };
  }

  /**
   * Convertit le type de temps en code numérique pour le ML
   */
  getWeatherCode(weatherMain) {
    const codes = {
      'Clear': 0,
      'Clouds': 1,
      'Rain': 2,
      'Drizzle': 2,
      'Thunderstorm': 3,
      'Snow': 4,
      'Mist': 5,
      'Fog': 5,
      'Haze': 5
    };
    return codes[weatherMain] || 1;
  }

  /**
   * Retourne des données météo par défaut si l'API n'est pas disponible
   */
  getDefaultWeather() {
    return {
      temperature: 15,
      humidity: 60,
      pressure: 1013,
      visibility: 10,
      windSpeed: 0,
      windDirection: 0,
      cloudiness: 30,
      weatherCode: 1,
      isRainy: false,
      isSnowy: false,
      isCloudy: false,
      isClear: true
    };
  }

  /**
   * Nettoie le cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = new WeatherService();
