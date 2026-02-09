const axios = require('axios');
const { getGoogleRoute } = require('./googleRoutes');

// Profils OpenRouteService : foot-walking, driving-car, cycling-regular
const ORS_PROFILES = { walking: 'foot-walking', driving: 'driving-car', transit: 'foot-walking', bicycling: 'cycling-regular' };

// Calculer un itinéraire (pied, voiture, vélo). Transit géré par Google si clé présente.
async function getWalkingRoute(start, end, profile = 'foot-walking') {
  return getRoute(start, end, 'walking');
}

async function getRoute(start, end, transportMode = 'walking') {
  const mode = transportMode === 'transit' ? 'transit' : transportMode === 'driving' ? 'driving' : transportMode === 'bicycling' ? 'bicycling' : 'walking';
  const departureTime = new Date();

  // Google Directions si clé configurée (pied, voiture, transit, vélo)
  const googleRoutes = await getGoogleRoute(start, end, mode, departureTime);
  if (googleRoutes && googleRoutes.length > 0) {
    return googleRoutes; // tableau de routes formatées
  }

  // OpenRouteService si clé configurée
  const orsKey = process.env.OPENROUTESERVICE_API_KEY;
  const orsProfile = ORS_PROFILES[mode] || 'foot-walking';
  if (orsKey) {
    try {
      const url = `https://api.openrouteservice.org/v2/directions/${orsProfile}/geojson`;
      const response = await axios.post(url, {
        coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
        format: 'geojson',
        geometry: true,
        instructions: false
      }, {
        headers: { 'Authorization': orsKey, 'Content-Type': 'application/json' },
        timeout: 15000
      });
      if (response.data && response.data.features && response.data.features.length > 0) {
        const f = response.data.features[0];
        const coords = f.geometry.coordinates;
        const dist = f.properties.segments && f.properties.segments[0] && f.properties.segments[0].distance ? f.properties.segments[0].distance : 0;
        const dur = f.properties.segments && f.properties.segments[0] && f.properties.segments[0].duration ? f.properties.segments[0].duration : 0;
        return [{
          type: 'direct',
          route: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: f.geometry, properties: { distance: dist, duration: dur } }] },
          distance: dist,
          duration: dur
        }];
      }
    } catch (e) {
      console.error('OpenRouteService error:', e.message);
    }
  }

  // Fallback : itinéraire simulé
  const single = await generateRealisticWalkingRoute(start, end);
  return [{
    type: 'direct',
    route: single,
    distance: single.features[0].properties.distance,
    duration: single.features[0].properties.duration
  }];
}

// Générer un itinéraire réaliste à pied avec des waypoints intermédiaires
function generateRealisticWalkingRoute(start, end) {
  const coordinates = [];
  
  // S'assurer que les coordonnées sont des nombres
  const startLat = typeof start.lat === 'number' ? start.lat : parseFloat(start.lat);
  const startLng = typeof start.lng === 'number' ? start.lng : parseFloat(start.lng);
  const endLat = typeof end.lat === 'number' ? end.lat : parseFloat(end.lat);
  const endLng = typeof end.lng === 'number' ? end.lng : parseFloat(end.lng);
  
  // Point de départ
  coordinates.push([parseFloat(startLng.toFixed(7)), parseFloat(startLat.toFixed(7))]);
  
  // Générer des waypoints intermédiaires pour créer un chemin réaliste
  const numWaypoints = 5;
  const latDiff = endLat - startLat;
  const lngDiff = endLng - startLng;
  
  for (let i = 1; i < numWaypoints; i++) {
    const ratio = i / numWaypoints;
    // Ajouter une légère variation pour simuler un chemin de rue
    const variation = (Math.random() - 0.5) * 0.002; // Variation de ~200m
    const lat = parseFloat((startLat + latDiff * ratio + variation).toFixed(7));
    const lng = parseFloat((startLng + lngDiff * ratio + variation * 0.7).toFixed(7));
    coordinates.push([lng, lat]);
  }
  
  // Point d'arrivée
  coordinates.push([parseFloat(endLng.toFixed(7)), parseFloat(endLat.toFixed(7))]);
  
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      },
      properties: {
        distance: calculateRouteDistance(coordinates),
        duration: calculateRouteDuration(coordinates)
      }
    }]
  };
}

// Calculer la distance totale d'un itinéraire
function calculateRouteDistance(coordinates) {
  let totalDistance = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[i + 1];
    totalDistance += haversineDistance(lat1, lng1, lat2, lng2);
  }
  return totalDistance * 1000; // En mètres
}

// Calculer la durée estimée (vitesse de marche : 5 km/h)
function calculateRouteDuration(coordinates) {
  const distance = calculateRouteDistance(coordinates) / 1000; // En km
  const walkingSpeed = 5; // km/h
  return (distance / walkingSpeed) * 3600; // En secondes
}

// Formule de Haversine pour calculer la distance entre deux points
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Rayon de la Terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Construire un objet route pour l'API à partir d'un résultat Google (ou fallback)
function buildRouteFromResult(r, type, density) {
  const routeObj = r.route;
  const dist = r.distance != null ? r.distance : (routeObj && routeObj.features && routeObj.features[0] && routeObj.features[0].properties && routeObj.features[0].properties.distance) || 0;
  const dur = r.duration != null ? r.duration : (routeObj && routeObj.features && routeObj.features[0] && routeObj.features[0].properties && routeObj.features[0].properties.duration) || 0;
  const f = routeObj && routeObj.features && routeObj.features[0];
  let distance = dist, duration = dur;
  if ((distance === 0 || duration === 0) && f && f.geometry && f.geometry.coordinates && f.geometry.coordinates.length >= 2) {
    if (distance === 0) distance = calculateRouteDistance(f.geometry.coordinates);
    if (duration === 0) duration = calculateRouteDuration(f.geometry.coordinates);
  }
  return {
    type,
    label: '',
    description: '',
    route: routeObj,
    distance: distance || 0,
    duration: duration || 0,
    avgDensity: density.avg,
    maxDensity: density.max,
    densityLevel: getDensityLevel(density.avg),
    color: getDensityColor(density.avg),
    transitInfo: r.transitInfo || null
  };
}

// Générer 3 variantes d'itinéraires avec différents niveaux de densité
// transportMode: 'walking' | 'driving' | 'transit' | 'bicycling'
async function generateThreeRouteVariants(start, end, zones, hour, dayOfWeek, transportMode = 'walking') {
  const routeResults = await getRoute(start, end, transportMode);
  const first = routeResults[0];
  let directRoute;
  let directDistance = 0, directDuration = 0;
  if (first && first.route && first.route.features && first.route.features[0]) {
    directRoute = first.route;
    directDistance = first.distance != null ? first.distance : (first.route.features[0].properties && first.route.features[0].properties.distance) || 0;
    directDuration = first.duration != null ? first.duration : (first.route.features[0].properties && first.route.features[0].properties.duration) || 0;
  } else {
    directRoute = await generateRealisticWalkingRoute(start, end);
    directDistance = directRoute.features[0].properties.distance;
    directDuration = directRoute.features[0].properties.duration;
  }
  const directDensity = calculateRouteDensity(directRoute, zones, hour, dayOfWeek);

  // Quand Google renvoie 3 alternatives (souvent en transit), on les utilise pour 3 itinéraires vraiment différents
  if (routeResults.length >= 3) {
    const routes = [
      buildRouteFromResult(routeResults[0], 'direct', calculateRouteDensity(routeResults[0].route, zones || [], hour, dayOfWeek)),
      buildRouteFromResult(routeResults[1], 'calm', calculateRouteDensity(routeResults[1].route, zones || [], hour, dayOfWeek)),
      buildRouteFromResult(routeResults[2], 'moderate', calculateRouteDensity(routeResults[2].route, zones || [], hour, dayOfWeek))
    ];
    routes.sort((a, b) => a.avgDensity - b.avgDensity);
    routes[0].label = 'Peu de monde';
    routes[0].description = 'Itinéraire le plus calme';
    routes[1].label = 'Moyen monde';
    routes[1].description = 'Itinéraire modéré';
    routes[2].label = 'Beaucoup de monde';
    routes[2].description = 'Itinéraire direct (peut être fréquenté)';
    return routes;
  }

  // 2 alternatives : on utilise les 2 et on duplique la première pour la 3e carte
  if (routeResults.length === 2) {
    const routes = [
      buildRouteFromResult(routeResults[0], 'direct', calculateRouteDensity(routeResults[0].route, zones || [], hour, dayOfWeek)),
      buildRouteFromResult(routeResults[1], 'calm', calculateRouteDensity(routeResults[1].route, zones || [], hour, dayOfWeek)),
      buildRouteFromResult(routeResults[0], 'moderate', calculateRouteDensity(routeResults[0].route, zones || [], hour, dayOfWeek))
    ];
    routes.sort((a, b) => a.avgDensity - b.avgDensity);
    routes[0].label = 'Peu de monde';
    routes[0].description = 'Itinéraire le plus calme';
    routes[1].label = 'Moyen monde';
    routes[1].description = 'Itinéraire modéré';
    routes[2].label = 'Beaucoup de monde';
    routes[2].description = 'Itinéraire direct (peut être fréquenté)';
    return routes;
  }

  // Une seule route : en mode marche avec zones on génère calm/moderate ; sinon on affiche 3 fois la même
  let calmRoute = directRoute;
  let moderateRoute = directRoute;
  if (transportMode === 'walking' && zones && zones.length > 0) {
    calmRoute = await generateCalmRoute(start, end, zones, hour, dayOfWeek);
    moderateRoute = await generateModerateRoute(start, end, zones, hour, dayOfWeek);
  }
  const calmDensity = calculateRouteDensity(calmRoute, zones || [], hour, dayOfWeek);
  const moderateDensity = calculateRouteDensity(moderateRoute, zones || [], hour, dayOfWeek);

  const getDistanceDuration = (routeObj, fallbackDist, fallbackDur) => {
    const f = routeObj && routeObj.features && routeObj.features[0];
    let d = (f && f.properties && f.properties.distance) != null ? f.properties.distance : fallbackDist;
    let t = (f && f.properties && f.properties.duration) != null ? f.properties.duration : fallbackDur;
    if ((d == null || d === 0 || t == null || t === 0) && f && f.geometry && f.geometry.coordinates && f.geometry.coordinates.length >= 2) {
      const coords = f.geometry.coordinates;
      if (d == null || d === 0) d = calculateRouteDistance(coords);
      if (t == null || t === 0) t = calculateRouteDuration(coords);
    }
    return { distance: d || 0, duration: t || 0 };
  };

  const directDD = getDistanceDuration(directRoute, directDistance, directDuration);
  const calmDD = getDistanceDuration(calmRoute, directDD.distance, directDD.duration);
  const modDD = getDistanceDuration(moderateRoute, directDD.distance, directDD.duration);

  const routes = [
    {
      type: 'direct',
      label: 'Itinéraire direct',
      description: transportMode === 'transit' ? 'Trajet direct (consulter les fréquences)' : 'Le chemin le plus court',
      route: directRoute,
      distance: directDD.distance,
      duration: directDD.duration,
      avgDensity: directDensity.avg,
      maxDensity: directDensity.max,
      densityLevel: getDensityLevel(directDensity.avg),
      color: getDensityColor(directDensity.avg),
      transitInfo: first && first.transitInfo ? first.transitInfo : null
    },
    {
      type: 'calm',
      label: 'Itinéraire calme',
      description: 'Évite les zones à forte affluence',
      route: calmRoute,
      distance: calmDD.distance,
      duration: calmDD.duration,
      avgDensity: calmDensity.avg,
      maxDensity: calmDensity.max,
      densityLevel: getDensityLevel(calmDensity.avg),
      color: getDensityColor(calmDensity.avg),
      transitInfo: first && first.transitInfo ? first.transitInfo : null
    },
    {
      type: 'moderate',
      label: 'Itinéraire modéré',
      description: 'Équilibre entre distance et tranquillité',
      route: moderateRoute,
      distance: modDD.distance,
      duration: modDD.duration,
      avgDensity: moderateDensity.avg,
      maxDensity: moderateDensity.max,
      densityLevel: getDensityLevel(moderateDensity.avg),
      color: getDensityColor(moderateDensity.avg),
      transitInfo: first && first.transitInfo ? first.transitInfo : null
    }
  ];

  routes.sort((a, b) => a.avgDensity - b.avgDensity);
  routes[0].label = 'Peu de monde';
  routes[0].description = 'Itinéraire le plus calme';
  routes[1].label = 'Moyen monde';
  routes[1].description = 'Itinéraire modéré';
  routes[2].label = 'Beaucoup de monde';
  routes[2].description = 'Itinéraire direct (peut être fréquenté)';

  return routes;
}

// Générer un itinéraire calme (évite les zones denses)
async function generateCalmRoute(start, end, zones, hour, dayOfWeek) {
  // Trouver les zones calmes pour créer des waypoints
  const calmZones = zones.filter(z => {
    const density = parseFloat(z.density_score || 50);
    return density < 40; // Zones très calmes
  });
  
  // Si on a des zones calmes, créer un itinéraire qui les traverse
  if (calmZones.length > 0) {
    // Trouver la zone calme la plus proche du milieu du trajet
    const midLat = (start.lat + end.lat) / 2;
    const midLng = (start.lng + end.lng) / 2;
    
    let closestCalmZone = calmZones[0];
    let minDist = haversineDistance(midLat, midLng, calmZones[0].latitude, calmZones[0].longitude);
    
    for (const zone of calmZones) {
      const dist = haversineDistance(midLat, midLng, zone.latitude, zone.longitude);
      if (dist < minDist) {
        minDist = dist;
        closestCalmZone = zone;
      }
    }
    
    // Créer un itinéraire via cette zone calme
    const waypoint = {
      lat: parseFloat(closestCalmZone.latitude),
      lng: parseFloat(closestCalmZone.longitude)
    };
    const route1Result = await getWalkingRoute(start, waypoint);
    const route2Result = await getWalkingRoute(waypoint, end);
    const r1 = route1Result && route1Result[0];
    const r2 = route2Result && route2Result[0];
    if (!r1 || !r2 || !r1.route?.features?.[0] || !r2.route?.features?.[0]) {
      return generateDetourRoute(start, end, 1.2);
    }
    const route1 = r1.route;
    const route2 = r2.route;
    // Combiner les deux segments (getWalkingRoute retourne un tableau [{ route, distance, duration }])
    const combinedCoords = [
      ...route1.features[0].geometry.coordinates.map((coord) => [
        parseFloat(coord[0].toFixed(7)),
        parseFloat(coord[1].toFixed(7))
      ]),
      ...route2.features[0].geometry.coordinates.slice(1).map((coord) => [
        parseFloat(coord[0].toFixed(7)),
        parseFloat(coord[1].toFixed(7))
      ]) // Éviter la duplication du point de jonction
    ];
    
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: combinedCoords
        },
        properties: {
          distance: calculateRouteDistance(combinedCoords),
          duration: calculateRouteDuration(combinedCoords)
        }
      }]
    };
  }
  
  // Sinon, générer un itinéraire avec un détour
  return generateDetourRoute(start, end, 1.2); // 20% plus long
}

// Générer un itinéraire modéré
async function generateModerateRoute(start, end, zones, hour, dayOfWeek) {
  // Itinéraire avec un petit détour, évitant les zones très denses
  return generateDetourRoute(start, end, 1.1); // 10% plus long
}

// Générer un itinéraire avec détour
function generateDetourRoute(start, end, detourFactor) {
  const coordinates = [];
  
  // S'assurer que les coordonnées sont des nombres
  const startLat = typeof start.lat === 'number' ? start.lat : parseFloat(start.lat);
  const startLng = typeof start.lng === 'number' ? start.lng : parseFloat(start.lng);
  const endLat = typeof end.lat === 'number' ? end.lat : parseFloat(end.lat);
  const endLng = typeof end.lng === 'number' ? end.lng : parseFloat(end.lng);
  
  coordinates.push([parseFloat(startLng.toFixed(7)), parseFloat(startLat.toFixed(7))]);
  
  // Créer un détour en ajoutant un waypoint décalé
  const midLat = (startLat + endLat) / 2;
  const midLng = (startLng + endLng) / 2;
  
  // Décaler le point médian perpendiculairement
  const latDiff = endLat - startLat;
  const lngDiff = endLng - startLng;
  const detourAmount = 0.003 * detourFactor; // ~300m de détour
  
  const detourLat = parseFloat((midLat + (lngDiff > 0 ? detourAmount : -detourAmount)).toFixed(7));
  const detourLng = parseFloat((midLng - (latDiff > 0 ? detourAmount : -detourAmount)).toFixed(7));
  
  coordinates.push([detourLng, detourLat]);
  coordinates.push([parseFloat(endLng.toFixed(7)), parseFloat(endLat.toFixed(7))]);
  
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      },
      properties: {
        distance: calculateRouteDistance(coordinates),
        duration: calculateRouteDuration(coordinates)
      }
    }]
  };
}

// Calculer la densité moyenne et maximale le long d'un itinéraire
function calculateRouteDensity(route, zones, hour, dayOfWeek) {
  const coordinates = route.features[0].geometry.coordinates;
  const densities = [];
  
  // Pour chaque segment de l'itinéraire
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lng1, lat1] = coordinates[i];
    const [lng2, lat2] = coordinates[i + 1];
    
    // Point médian du segment
    const midLat = (lat1 + lat2) / 2;
    const midLng = (lng1 + lng2) / 2;
    
    // Trouver la densité à ce point
    let minDistance = Infinity;
    let closestDensity = 30; // Densité par défaut
    
    for (const zone of zones) {
      const dist = haversineDistance(midLat, midLng, zone.latitude, zone.longitude) * 1000; // En mètres
      if (dist < zone.radius && dist < minDistance) {
        minDistance = dist;
        closestDensity = parseFloat(zone.density_score || 50);
      }
    }
    
    densities.push(closestDensity);
  }
  
  const avg = densities.length > 0 
    ? densities.reduce((a, b) => a + b, 0) / densities.length 
    : 30;
  const max = densities.length > 0 ? Math.max(...densities) : 30;
  
  return { avg, max, densities };
}

// Déterminer le niveau de densité
function getDensityLevel(density) {
  if (density < 30) return 'peu';
  if (density < 50) return 'moyen';
  return 'beaucoup';
}

// Obtenir la couleur selon la densité
function getDensityColor(density) {
  if (density < 30) return '#7BC27B'; // Vert - très calme
  if (density < 50) return '#84CC16'; // Vert clair - calme
  if (density < 70) return '#EAB308'; // Jaune - modéré
  if (density < 85) return '#F97316'; // Orange - élevé
  return '#EF4444'; // Rouge - très élevé
}

module.exports = {
  getWalkingRoute,
  getRoute,
  generateThreeRouteVariants,
  calculateRouteDensity
};
