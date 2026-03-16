const db = require('../../config/baseDonnees');
const weatherService = require('./serviceMeteo');

/**
 * Préprocesseur de données pour le Machine Learning
 * Prépare les données d'entraînement à partir de l'historique utilisateur
 */
class DataPreprocessor {
  /**
   * Récupère toutes les données d'entraînement pour un utilisateur
   * @param {number} userId - ID de l'utilisateur
   * @returns {Promise<Array>} Tableau de données normalisées
   */
  async getTrainingData(userId) {
    try {
      // Récupérer les trajets avec leurs données associées
      const [routes] = await db.pool.execute(
        `SELECT 
          r.id,
          r.start_lat,
          r.start_lng,
          r.end_lat,
          r.end_lng,
          r.density_score,
          r.created_at,
          r.recommended_path,
          HOUR(r.created_at) as hour,
          DAYOFWEEK(r.created_at) as day_of_week,
          DAYOFYEAR(r.created_at) as day_of_year
        FROM routes r
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
        LIMIT 1000`,
        [userId]
      );

      // Récupérer les entrées de mood associées aux trajets
      const [moodEntries] = await db.pool.execute(
        `SELECT entry_date, mood FROM mood_entries WHERE user_id = ?`,
        [userId]
      );

      const moodMap = {};
      moodEntries.forEach(entry => {
        const dateStr = entry.entry_date.toISOString().slice(0, 10);
        moodMap[dateStr] = this.moodToNumber(entry.mood);
      });

      // Préparer les données d'entraînement
      const trainingData = [];
      
      for (const route of routes) {
        const routeDate = new Date(route.created_at);
        const dateStr = routeDate.toISOString().slice(0, 10);
        
        // Récupérer les données météo (avec cache)
        const weather = await weatherService.getWeather(
          route.start_lat,
          route.start_lng
        );

        // Calculer la distance du trajet
        const distance = this.calculateDistance(
          route.start_lat,
          route.start_lng,
          route.end_lat,
          route.end_lng
        );

        // Extraire le type de transport si disponible dans recommended_path
        const transportMode = this.extractTransportMode(route.recommended_path);

        // Mood associé (si disponible)
        const mood = moodMap[dateStr] || null;

        // Créer le vecteur de caractéristiques
        const features = {
          // Caractéristiques temporelles
          hour: route.hour,
          dayOfWeek: route.day_of_week,
          dayOfYear: route.day_of_year,
          isWeekend: route.day_of_week === 0 || route.day_of_week === 6 ? 1 : 0,
          isRushHour: (route.hour >= 7 && route.hour <= 9) || (route.hour >= 17 && route.hour <= 19) ? 1 : 0,
          
          // Caractéristiques géographiques
          startLat: route.start_lat,
          startLng: route.start_lng,
          endLat: route.end_lat,
          endLng: route.end_lng,
          distance: distance,
          
          // Caractéristiques de densité
          densityScore: route.density_score || 50,
          
          // Caractéristiques météo
          temperature: weather.temperature,
          humidity: weather.humidity,
          pressure: weather.pressure,
          visibility: weather.visibility,
          windSpeed: weather.windSpeed,
          cloudiness: weather.cloudiness,
          weatherCode: weather.weatherCode,
          isRainy: weather.isRainy ? 1 : 0,
          isSnowy: weather.isSnowy ? 1 : 0,
          isCloudy: weather.isCloudy ? 1 : 0,
          
          // Type de transport (encodé)
          transportMode: transportMode,
          
          // Label (mood si disponible, sinon null)
          anxietyLevel: mood
        };

        trainingData.push(features);
      }

      return trainingData;
    } catch (error) {
      console.error('Error preparing training data:', error);
      return [];
    }
  }

  /**
   * Récupère les données agrégées de tous les utilisateurs (pour clustering)
   */
  async getAllUsersTrainingData(limit = 5000) {
    try {
      const [routes] = await db.pool.execute(
        `SELECT 
          r.user_id,
          r.start_lat,
          r.start_lng,
          r.end_lat,
          r.end_lng,
          r.density_score,
          r.created_at,
          HOUR(r.created_at) as hour,
          DAYOFWEEK(r.created_at) as day_of_week
        FROM routes r
        ORDER BY r.created_at DESC
        LIMIT ?`,
        [limit]
      );

      const trainingData = [];
      for (const route of routes) {
        const weather = await weatherService.getWeather(
          route.start_lat,
          route.start_lng
        );

        const distance = this.calculateDistance(
          route.start_lat,
          route.start_lng,
          route.end_lat,
          route.end_lng
        );

        trainingData.push({
          userId: route.user_id,
          hour: route.hour,
          dayOfWeek: route.day_of_week,
          isWeekend: route.day_of_week === 0 || route.day_of_week === 6 ? 1 : 0,
          isRushHour: (route.hour >= 7 && route.hour <= 9) || (route.hour >= 17 && route.hour <= 19) ? 1 : 0,
          distance: distance,
          densityScore: route.density_score || 50,
          temperature: weather.temperature,
          humidity: weather.humidity,
          visibility: weather.visibility,
          weatherCode: weather.weatherCode
        });
      }

      return trainingData;
    } catch (error) {
      console.error('Error preparing all users training data:', error);
      return [];
    }
  }

  /**
   * Convertit le mood en nombre pour le ML
   */
  moodToNumber(mood) {
    const moodMap = {
      'great': 1,    // Très bien - faible anxiété
      'good': 2,     // Bien - anxiété faible
      'okay': 3,     // Correct - anxiété modérée
      'meh': 4,      // Bof - anxiété modérée-élevée
      'bad': 5       // Difficile - anxiété élevée
    };
    return moodMap[mood] || 3;
  }

  /**
   * Convertit un nombre en mood
   */
  numberToMood(number) {
    const moodMap = {
      1: 'great',
      2: 'good',
      3: 'okay',
      4: 'meh',
      5: 'bad'
    };
    return moodMap[Math.round(number)] || 'okay';
  }

  /**
   * Calcule la distance entre deux points (Haversine)
   */
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Extrait le type de transport depuis recommended_path
   */
  extractTransportMode(recommendedPath) {
    if (!recommendedPath) return 0; // walking par défaut
    
    try {
      const path = typeof recommendedPath === 'string' 
        ? JSON.parse(recommendedPath) 
        : recommendedPath;
      
      // Encodage: 0=walking, 1=driving, 2=transit, 3=bicycling
      // Pour l'instant, on retourne 0 (walking) par défaut
      // Peut être amélioré en analysant la structure du path
      return 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Normalise les caractéristiques pour le modèle ML
   */
  normalizeFeatures(features) {
    return {
      hour: features.hour / 23,
      dayOfWeek: features.dayOfWeek / 6,
      isWeekend: features.isWeekend,
      isRushHour: features.isRushHour,
      distance: Math.min(features.distance / 50, 1), // Normaliser sur 50km max
      densityScore: features.densityScore / 100,
      temperature: (features.temperature + 20) / 50, // Normaliser entre -20 et 30°C
      humidity: features.humidity / 100,
      visibility: Math.min(features.visibility / 20, 1), // Normaliser sur 20km max
      weatherCode: features.weatherCode / 5,
      isRainy: features.isRainy,
      isSnowy: features.isSnowy,
      isCloudy: features.isCloudy,
      transportMode: features.transportMode / 3
    };
  }
}

module.exports = new DataPreprocessor();
