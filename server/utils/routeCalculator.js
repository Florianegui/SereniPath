// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Check if a point is within a zone
function isPointInZone(lat, lng, zoneLat, zoneLng, radius) {
  const distance = calculateDistance(lat, lng, zoneLat, zoneLng);
  return distance * 1000 <= radius; // Convert km to meters
}

// Calculate optimal route avoiding high-density zones
function calculateOptimalRoute(start, end, zones, maxDensity = 50) {
  // Simple pathfinding: create waypoints avoiding high-density zones
  const path = [start];
  const waypoints = [];
  
  // Find zones to avoid (high density)
  const zonesToAvoid = zones.filter(z => parseFloat(z.density_score) > maxDensity);
  
  // Calculate direct distance
  const directDistance = calculateDistance(start.lat, start.lng, end.lat, end.lng);
  
  // If direct path doesn't go through high-density zones, use it
  let directPathSafe = true;
  for (const zone of zonesToAvoid) {
    // Simple check: if start or end is in zone, or if path crosses zone
    if (isPointInZone(start.lat, start.lng, zone.latitude, zone.longitude, zone.radius) ||
        isPointInZone(end.lat, end.lng, zone.latitude, zone.longitude, zone.radius)) {
      directPathSafe = false;
      break;
    }
  }
  
  if (directPathSafe) {
    path.push(end);
  } else {
    // Find alternative waypoints (zones with low density)
    const lowDensityZones = zones
      .filter(z => parseFloat(z.density_score) <= maxDensity)
      .sort((a, b) => parseFloat(a.density_score) - parseFloat(b.density_score));
    
    // Try to find a path through low-density zones
    if (lowDensityZones.length > 0) {
      // Use first low-density zone as waypoint if it's roughly between start and end
      const midLat = (start.lat + end.lat) / 2;
      const midLng = (start.lng + end.lng) / 2;
      
      // Find closest low-density zone to midpoint
      let closestZone = lowDensityZones[0];
      let minDist = calculateDistance(midLat, midLng, closestZone.latitude, closestZone.longitude);
      
      for (const zone of lowDensityZones.slice(1)) {
        const dist = calculateDistance(midLat, midLng, zone.latitude, zone.longitude);
        if (dist < minDist) {
          minDist = dist;
          closestZone = zone;
        }
      }
      
      if (minDist < directDistance * 0.5) {
        path.push({
          lat: closestZone.latitude,
          lng: closestZone.longitude,
          name: closestZone.name,
          density: parseFloat(closestZone.density_score)
        });
      }
    }
    
    path.push(end);
  }
  
  // Calculate average density along path
  let totalDensity = 0;
  let densityCount = 0;
  
  for (let i = 0; i < path.length - 1; i++) {
    const point1 = path[i];
    const point2 = path[i + 1];
    
    // Check density of zones along this segment
    for (const zone of zones) {
      const dist1 = calculateDistance(point1.lat, point1.lng, zone.latitude, zone.longitude);
      const dist2 = calculateDistance(point2.lat, point2.lng, zone.latitude, zone.longitude);
      
      if (dist1 * 1000 <= zone.radius || dist2 * 1000 <= zone.radius) {
        totalDensity += parseFloat(zone.density_score);
        densityCount++;
      }
    }
  }
  
  const avgDensity = densityCount > 0 ? totalDensity / densityCount : 30;
  
  // Calculate total distance
  let totalDistance = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalDistance += calculateDistance(
      path[i].lat,
      path[i].lng,
      path[i + 1].lat,
      path[i + 1].lng
    );
  }
  
  return {
    path,
    avgDensity: avgDensity.toFixed(2),
    totalDistance: totalDistance.toFixed(2),
    waypoints: path.slice(1, -1),
    safety: avgDensity < maxDensity ? 'safe' : avgDensity < maxDensity * 1.2 ? 'moderate' : 'high'
  };
}

module.exports = {
  calculateOptimalRoute,
  calculateDistance
};
