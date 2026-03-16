const express = require('express');
const db = require('../config/baseDonnees');
const { updateMultipleZonesDensity } = require('../utils/densiteTempsReel');
const { getPoiDensityInArea } = require('../utils/densitePoi');
const { geocodeAddress } = require('../utils/geocodage');

const router = express.Router();

// Géocodage d'une ville en France (public, pas d'auth) pour le sélecteur de ville
router.get('/city', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ message: 'Paramètre q requis (nom de ville)' });
    }
    const result = await geocodeAddress(q);
    if (!result) {
      return res.status(404).json({ message: 'Ville non trouvée en France' });
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Ville non trouvée' });
  }
});

// Densité par zone géographique (ville) : POIs type resto, bar, musée, gare, etc. selon heure/jour
// Affluence estimée en fonction de l'heure et du jour pour chaque type de lieu
router.get('/by-area', async (req, res) => {
  let lat;
  let lng;
  try {
    lat = parseFloat(req.query.lat);
    lng = parseFloat(req.query.lng);
    const radius = Math.min(parseInt(req.query.radius, 10) || 12000, 20000); // Max 20km pour grandes villes
    const hour = req.query.hour !== undefined ? parseInt(req.query.hour, 10) : new Date().getHours();
    const dayOfWeek = req.query.dayOfWeek !== undefined ? parseInt(req.query.dayOfWeek, 10) : new Date().getDay();
    const limit = Math.min(parseInt(req.query.limit, 10) || 300, 500);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Coordonnées lat/lng invalides' });
    }

    const zones = await getPoiDensityInArea(lat, lng, radius, hour, dayOfWeek);
    console.log(`[Density API] Found ${zones.length} zones for lat=${lat}, lng=${lng}, radius=${radius}m`);
    const data = (Array.isArray(zones) ? zones : []).slice(0, limit).map(z => ({
      id: z.id,
      name: z.name,
      latitude: Number(z.latitude),
      longitude: Number(z.longitude),
      radius: z.radius,
      avg_density: z.density_score,
      max_density: z.density_score,
      min_density: z.density_score,
      avg_reliability: 0.8,
      poi_type: z.poi_type
    }));

    res.json(data);
  } catch (err) {
    console.error('Density by-area error:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Erreur lors du chargement des densités' });
    }
  }
});

// Get density for a zone at specific time
router.get('/zone/:zoneId', async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { hour, dayOfWeek } = req.query;

    let query = 'SELECT * FROM density_data WHERE zone_id = ?';
    const params = [zoneId];

    if (hour !== undefined) {
      query += ' AND hour = ?';
      params.push(parseInt(hour));
    }

    if (dayOfWeek !== undefined) {
      query += ' AND day_of_week = ?';
      params.push(parseInt(dayOfWeek));
    }

    query += ' ORDER BY timestamp DESC LIMIT 1';

    const [data] = await db.pool.execute(query, params);

    if (data.length === 0) {
      return res.status(404).json({ message: 'Density data not found' });
    }

    res.json(data[0]);
  } catch (error) {
    console.error('Get density error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get density for all zones at specific time
router.get('/all', async (req, res) => {
  try {
    const { hour, dayOfWeek } = req.query;
    const currentHour = hour !== undefined ? parseInt(hour) : new Date().getHours();
    const currentDay = dayOfWeek !== undefined ? parseInt(dayOfWeek) : new Date().getDay();

    const [data] = await db.pool.execute(
      `SELECT d.*, z.name, z.latitude, z.longitude, z.radius 
       FROM density_data d
       JOIN zones z ON d.zone_id = z.id
       WHERE d.hour = ? AND d.day_of_week = ?
       ORDER BY d.density_score ASC`,
      [currentHour, currentDay]
    );

    res.json(data);
  } catch (error) {
    console.error('Get all density error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get density heatmap data
router.get('/heatmap', async (req, res) => {
  try {
    const { hour, dayOfWeek } = req.query;
    const currentHour = hour !== undefined ? parseInt(hour) : new Date().getHours();
    const currentDay = dayOfWeek !== undefined ? parseInt(dayOfWeek) : new Date().getDay();

    // Récupérer toutes les zones
    const [zones] = await db.pool.execute(
      `SELECT 
        z.id,
        z.name,
        z.latitude,
        z.longitude,
        z.radius
       FROM zones z
       ORDER BY z.id`
    );

    // Mettre à jour avec les données en temps réel
    const zonesWithDensity = await updateMultipleZonesDensity(zones, currentHour, currentDay);

    // Formater les données pour la réponse
    const data = zonesWithDensity.map(zone => ({
      id: zone.id,
      name: zone.name,
      latitude: zone.latitude,
      longitude: zone.longitude,
      radius: zone.radius,
      avg_density: zone.density_score,
      max_density: zone.density_score,
      min_density: zone.density_score,
      avg_reliability: zone.reliability_score || 0.85
    }));

    res.json(data);
  } catch (error) {
    console.error('Get heatmap error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
