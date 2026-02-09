const express = require('express');
const db = require('../config/database');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Get all zones
router.get('/', async (req, res) => {
  try {
    const [zones] = await db.pool.execute(
      'SELECT * FROM zones ORDER BY name'
    );
    res.json(zones);
  } catch (error) {
    console.error('Get zones error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get zone by ID
router.get('/:id', async (req, res) => {
  try {
    const [zones] = await db.pool.execute(
      'SELECT * FROM zones WHERE id = ?',
      [req.params.id]
    );

    if (zones.length === 0) {
      return res.status(404).json({ message: 'Zone not found' });
    }

    res.json(zones[0]);
  } catch (error) {
    console.error('Get zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create zone (admin only - for now, allow authenticated users)
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, latitude, longitude, radius } = req.body;

    const [result] = await db.pool.execute(
      'INSERT INTO zones (name, latitude, longitude, radius) VALUES (?, ?, ?, ?)',
      [name, latitude, longitude, radius || 500]
    );

    res.status(201).json({
      id: result.insertId,
      name,
      latitude,
      longitude,
      radius: radius || 500
    });
  } catch (error) {
    console.error('Create zone error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
