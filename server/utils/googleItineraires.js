const axios = require('axios');

/**
 * Itinéraires via Google Directions API (Maps Platform)
 * https://developers.google.com/maps/documentation/directions
 * Modes: walking, driving, transit (transit = fréquences / moins de monde selon horaire)
 */
const MODES = {
  walking: 'walking',
  driving: 'driving',
  transit: 'transit',
  bicycling: 'bicycling'
};

async function getGoogleRoute(origin, destination, mode = 'walking', departureTime = null) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const modeVal = MODES[mode] || 'walking';
  let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&mode=${modeVal}&alternatives=true&key=${apiKey}`;
  if (modeVal === 'transit' && departureTime) {
    url += `&departure_time=${Math.floor(departureTime.getTime() / 1000)}`;
  }

  try {
    const response = await axios.get(url, { timeout: 15000 });
    if (response.data.status !== 'OK') return null;
    return formatGoogleDirections(response.data, origin, destination);
  } catch (err) {
    console.error('Google Directions error:', err.message);
    return null;
  }
}

function formatTransitStep(step) {
  const td = step.transit_details;
  if (!td || !td.line) return null;
  const line = td.line;
  const vehicle = (line.vehicle && line.vehicle.name) || 'Transport';
  const lineName = line.short_name || line.name || '';
  const departureStop = (td.departure_stop && td.departure_stop.name) || '';
  const arrivalStop = (td.arrival_stop && td.arrival_stop.name) || '';
  const numStops = td.num_stops != null ? td.num_stops : 0;
  const headsign = td.headsign || (line.vehicle && line.vehicle.name) || '';
  return {
    vehicle,
    lineName,
    departureStop,
    arrivalStop,
    numStops,
    headsign
  };
}

function formatGoogleDirections(data, origin, destination) {
  const routes = (data.routes || []).slice(0, 3).map((r, i) => {
    const leg = r.legs && r.legs[0];
    if (!leg) return null;
    const steps = leg.steps || [];
    const coordinates = decodePolyline(steps);
    const distance = leg.distance && leg.distance.value ? leg.distance.value : 0;
    const duration = leg.duration && leg.duration.value ? leg.duration.value : 0;
    const transitSteps = steps.filter(s => s.travel_mode === 'TRANSIT');
    const transitDetails = transitSteps.map(s => formatTransitStep(s)).filter(Boolean);
    const transitInfo = transitDetails.length > 0
      ? {
          steps: transitDetails.length,
          lines: transitDetails.map(t => t.lineName || t.vehicle).filter(Boolean),
          instructions: transitDetails
        }
      : null;
    return {
      type: i === 0 ? 'direct' : i === 1 ? 'calm' : 'moderate',
      route: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { distance, duration, transitInfo }
        }]
      },
      distance,
      duration,
      transitInfo,
      summary: leg.summary || ''
    };
  }).filter(Boolean);

  return routes;
}

function decodePolyline(steps) {
  if (!steps || !steps.length) return [];
  const coords = [];
  for (const step of steps) {
    if (step.start_location) {
      coords.push([step.start_location.lng, step.start_location.lat]);
    }
    if (step.polyline && step.polyline.points) {
      const decoded = decodeGooglePolyline(step.polyline.points);
      coords.push(...decoded);
    }
    if (step.end_location) {
      coords.push([step.end_location.lng, step.end_location.lat]);
    }
  }
  return coords;
}

function decodeGooglePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

module.exports = {
  getGoogleRoute,
  MODES
};
