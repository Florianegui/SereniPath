const express = require('express');
const db = require('../config/baseDonnees');
const authenticate = require('../middleware/authentification');
const { getPopulationStats, getAnxietyStats, getHourlyAffluenceStats, getArrondissementStats } = require('../utils/statistiquesPopulation');

const router = express.Router();

// Get user statistics
router.get('/user', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Nombre total de trajets
    const [totalRoutes] = await db.pool.execute(
      'SELECT COUNT(*) as count FROM routes WHERE user_id = ?',
      [userId]
    );

    // Distance totale parcourue
    const [totalDistance] = await db.pool.execute(
      `SELECT 
        SUM(JSON_LENGTH(recommended_path)) as total_segments,
        AVG(density_score) as avg_density
       FROM routes 
       WHERE user_id = ?`,
      [userId]
    );

    // Trajets par jour de la semaine
    const [routesByDay] = await db.pool.execute(
      `SELECT 
        DAYOFWEEK(created_at) as day_of_week,
        COUNT(*) as count
       FROM routes 
       WHERE user_id = ?
       GROUP BY DAYOFWEEK(created_at)
       ORDER BY day_of_week`,
      [userId]
    );

    // Trajets par heure
    const [routesByHour] = await db.pool.execute(
      `SELECT 
        HOUR(created_at) as hour,
        COUNT(*) as count
       FROM routes 
       WHERE user_id = ?
       GROUP BY HOUR(created_at)
       ORDER BY hour`,
      [userId]
    );

    // Zones les plus fréquentées par l'utilisateur
    // Approche simplifiée : trouver les zones proches des points de départ/arrivée
    const [frequentZones] = await db.pool.execute(
      `SELECT 
        z.name,
        z.latitude,
        z.longitude,
        COUNT(*) as visit_count,
        AVG(r.density_score) as avg_density
       FROM routes r
       CROSS JOIN zones z
       WHERE r.user_id = ?
         AND (
           ABS(r.start_lat - z.latitude) < 0.01 AND ABS(r.start_lng - z.longitude) < 0.01
           OR ABS(r.end_lat - z.latitude) < 0.01 AND ABS(r.end_lng - z.longitude) < 0.01
         )
       GROUP BY z.id, z.name, z.latitude, z.longitude
       ORDER BY visit_count DESC
       LIMIT 5`,
      [userId]
    );

    // Itinéraires préférés (par densité moyenne)
    const [preferredRoutes] = await db.pool.execute(
      `SELECT 
        start_lat,
        start_lng,
        end_lat,
        end_lng,
        COUNT(*) as count,
        AVG(density_score) as avg_density
       FROM routes 
       WHERE user_id = ?
       GROUP BY start_lat, start_lng, end_lat, end_lng
       ORDER BY count DESC
       LIMIT 5`,
      [userId]
    );

    // Statistiques de densité (avec density_level si disponible, sinon calculé)
    const [densityStats] = await db.pool.execute(
      `SELECT 
        AVG(density_score) as avg_density,
        MIN(density_score) as min_density,
        MAX(density_score) as max_density,
        COUNT(CASE WHEN density_level = 'calm' OR (density_level IS NULL AND density_score < 30) THEN 1 END) as calm_routes,
        COUNT(CASE WHEN density_level = 'moderate' OR (density_level IS NULL AND density_score >= 30 AND density_score < 60) THEN 1 END) as moderate_routes,
        COUNT(CASE WHEN density_level = 'elevated' OR (density_level IS NULL AND density_score >= 60) THEN 1 END) as elevated_routes
       FROM routes 
       WHERE user_id = ?`,
      [userId]
    );

    // Évolution hebdomadaire des trajets (dernières 12 semaines)
    const [weeklyEvolution] = await db.pool.execute(
      `SELECT 
        YEAR(created_at) as year,
        WEEK(created_at, 1) as week,
        DATE_FORMAT(DATE_SUB(created_at, INTERVAL WEEKDAY(created_at) DAY), '%Y-%m-%d') as week_start,
        COUNT(*) as count
       FROM routes 
       WHERE user_id = ?
         AND created_at >= DATE_SUB(NOW(), INTERVAL 12 WEEK)
       GROUP BY YEAR(created_at), WEEK(created_at, 1), week_start
       ORDER BY year DESC, week DESC
       LIMIT 12`,
      [userId]
    );

    // Répartition par type de transport
    const [transportDistribution] = await db.pool.execute(
      `SELECT 
        COALESCE(transport_type, 'walking') as transport_type,
        COUNT(*) as count
       FROM routes 
       WHERE user_id = ?
       GROUP BY COALESCE(transport_type, 'walking')
       ORDER BY count DESC`,
      [userId]
    );

    res.json({
      totalRoutes: totalRoutes[0].count,
      totalDistance: totalDistance[0].total_segments || 0,
      avgDensity: parseFloat(totalDistance[0].avg_density || 0).toFixed(2),
      routesByDay: routesByDay.map(r => ({
        day: r.day_of_week,
        count: r.count,
        dayName: getDayName(r.day_of_week)
      })),
      routesByHour: routesByHour.map(r => ({
        hour: r.hour,
        count: r.count
      })),
      frequentZones: frequentZones.map(z => ({
        name: z.name,
        latitude: z.latitude,
        longitude: z.longitude,
        visitCount: z.visit_count,
        avgDensity: parseFloat(z.avg_density || 0).toFixed(2)
      })),
      preferredRoutes: preferredRoutes.map(r => ({
        start: { lat: r.start_lat, lng: r.start_lng },
        end: { lat: r.end_lat, lng: r.end_lng },
        count: r.count,
        avgDensity: parseFloat(r.avg_density || 0).toFixed(2)
      })),
      densityStats: {
        avg: parseFloat(densityStats[0].avg_density || 0).toFixed(2),
        min: parseFloat(densityStats[0].min_density || 0).toFixed(2),
        max: parseFloat(densityStats[0].max_density || 0).toFixed(2),
        calm: densityStats[0].calm_routes || 0,
        moderate: densityStats[0].moderate_routes || 0,
        busy: densityStats[0].elevated_routes || 0
      },
      weeklyEvolution: weeklyEvolution.map(w => ({
        week: `${w.year}-W${String(w.week).padStart(2, '0')}`,
        weekStart: w.week_start,
        count: w.count
      })).reverse(), // Inverser pour avoir les plus anciennes en premier
      transportDistribution: transportDistribution.map(t => ({
        type: t.transport_type === 'walking' ? 'À pied' :
              t.transport_type === 'car' ? 'Voiture' :
              t.transport_type === 'transport' ? 'Transport en commun' :
              t.transport_type === 'bicycle' ? 'Vélo' : t.transport_type,
        count: t.count
      }))
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get global statistics
router.get('/global', async (req, res) => {
  try {
    // Nombre total d'utilisateurs
    const [totalUsers] = await db.pool.execute('SELECT COUNT(*) as count FROM users');

    // Nombre total de trajets
    const [totalRoutes] = await db.pool.execute('SELECT COUNT(*) as count FROM routes');

    // Zones les plus fréquentées (global)
    const [popularZones] = await db.pool.execute(
      `SELECT 
        z.name,
        z.latitude,
        z.longitude,
        COUNT(DISTINCT r.user_id) as user_count,
        COUNT(r.id) as route_count,
        AVG(r.density_score) as avg_density
       FROM zones z
       LEFT JOIN routes r ON (
         ABS(r.start_lat - z.latitude) < 0.01 AND ABS(r.start_lng - z.longitude) < 0.01
         OR ABS(r.end_lat - z.latitude) < 0.01 AND ABS(r.end_lng - z.longitude) < 0.01
       )
       GROUP BY z.id, z.name, z.latitude, z.longitude
       ORDER BY route_count DESC, user_count DESC
       LIMIT 10`
    );

    // Heures les plus populaires
    const [popularHours] = await db.pool.execute(
      `SELECT 
        HOUR(created_at) as hour,
        COUNT(*) as count
       FROM routes
       GROUP BY HOUR(created_at)
       ORDER BY count DESC
       LIMIT 5`
    );

    // Statistiques de densité globale
    const [globalDensity] = await db.pool.execute(
      `SELECT 
        AVG(density_score) as avg_density,
        COUNT(CASE WHEN density_score < 30 THEN 1 END) as calm_routes,
        COUNT(CASE WHEN density_score >= 30 AND density_score < 60 THEN 1 END) as moderate_routes,
        COUNT(CASE WHEN density_score >= 60 THEN 1 END) as busy_routes
       FROM routes`
    );

    res.json({
      totalUsers: totalUsers[0].count,
      totalRoutes: totalRoutes[0].count,
      popularZones: popularZones.map(z => ({
        name: z.name,
        latitude: z.latitude,
        longitude: z.longitude,
        userCount: z.user_count || 0,
        routeCount: z.route_count || 0,
        avgDensity: parseFloat(z.avg_density || 0).toFixed(2)
      })),
      popularHours: popularHours.map(h => ({
        hour: h.hour,
        count: h.count
      })),
      globalDensity: {
        avg: parseFloat(globalDensity[0].avg_density || 0).toFixed(2),
        calm: globalDensity[0].calm_routes || 0,
        moderate: globalDensity[0].moderate_routes || 0,
        busy: globalDensity[0].busy_routes || 0
      }
    });
  } catch (error) {
    console.error('Get global stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get real population and anxiety statistics
router.get('/population', async (req, res) => {
  try {
    const populationStats = await getPopulationStats();
    const anxietyStats = getAnxietyStats();
    const hourlyAffluence = getHourlyAffluenceStats();
    const arrondissementStats = getArrondissementStats();

    res.json({
      population: {
        total: populationStats.totalPopulation,
        area: populationStats.area,
        density: populationStats.density,
        arrondissements: populationStats.arrondissements,
        lastUpdated: populationStats.lastUpdated,
        sources: populationStats.sources
      },
      anxiety: anxietyStats,
      hourlyAffluence: Object.entries(hourlyAffluence).map(([hour, data]) => ({
        hour: parseInt(hour),
        metro: data.metro,
        bus: data.bus,
        total: data.metro + data.bus,
        description: data.description
      })),
      arrondissements: arrondissementStats,
      insights: {
        mostDense: arrondissementStats.sort((a, b) => b.density - a.density).slice(0, 3),
        mostPopulated: arrondissementStats.sort((a, b) => b.population - a.population).slice(0, 3),
        peakHours: Object.entries(hourlyAffluence)
          .sort(([, a], [, b]) => (b.metro + b.bus) - (a.metro + a.bus))
          .slice(0, 3)
          .map(([hour, data]) => ({
            hour: parseInt(hour),
            total: data.metro + data.bus,
            description: data.description
          }))
      }
    });
  } catch (error) {
    console.error('Get population stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper function
function getDayName(dayOfWeek) {
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  return days[dayOfWeek - 1] || 'Inconnu';
}

module.exports = router;
