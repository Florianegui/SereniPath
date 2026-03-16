const express = require('express');
const db = require('../config/baseDonnees');
const authenticate = require('../middleware/authentification');

const router = express.Router();

// GET /api/safe-places — liste des lieux sécurisants de l'utilisateur
router.get('/', authenticate, async (req, res) => {
  try {
    await ensureSafePlacesTable();
    const [rows] = await db.pool.execute(
      `SELECT id, name, latitude, longitude, place_type, notes, created_at
       FROM safe_places
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.user.userId]
    );
    res.json({ places: rows });
  } catch (err) {
    console.error('Safe places GET error:', err);
    if (err.code === 'ER_NO_SUCH_TABLE') {
      try {
        await ensureSafePlacesTable();
        return res.json({ places: [] });
      } catch (e) {
        console.error('ensureSafePlacesTable error:', e);
      }
    }
    res.status(500).json({ message: 'Erreur lors de la récupération des lieux' });
  }
});

// Créer la table safe_places si elle n'existe pas
async function ensureSafePlacesTable() {
  const [tables] = await db.pool.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'safe_places'`
  );
  if (tables.length === 0) {
    await db.pool.execute(
      `CREATE TABLE safe_places (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        place_type VARCHAR(50) DEFAULT 'other',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user (user_id)
      )`
    );
    console.log('✅ Table safe_places créée (à la volée)');
  }
}

// POST /api/safe-places — ajouter un lieu
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, latitude, longitude, place_type, notes } = req.body;
    console.log('Safe places POST:', { userId: req.user?.userId, name, latitude, longitude });
    if (!name || latitude == null || longitude == null) {
      return res.status(400).json({ message: 'Nom, latitude et longitude sont requis' });
    }
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Coordonnées invalides' });
    }
    await ensureSafePlacesTable();
    const [result] = await db.pool.execute(
      `INSERT INTO safe_places (user_id, name, latitude, longitude, place_type, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.userId,
        String(name).trim(),
        lat,
        lng,
        place_type || 'other',
        notes ? String(notes).trim() : null
      ]
    );
    const [rows] = await db.pool.execute(
      'SELECT id, name, latitude, longitude, place_type, notes, created_at FROM safe_places WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Safe places POST error:', err);
    if (err.code === 'ER_NO_SUCH_TABLE') {
      try {
        await ensureSafePlacesTable();
        return res.status(503).json({ message: 'Table créée. Veuillez réessayer.' });
      } catch (e) {
        console.error('ensureSafePlacesTable error:', e);
      }
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
      return res.status(400).json({ message: 'Utilisateur non trouvé. Reconnectez-vous.' });
    }
    const msg = err.message || 'Erreur lors de l\'ajout du lieu';
    res.status(500).json({
      message: msg,
      ...(process.env.NODE_ENV === 'development' && { error: err.code || err.message })
    });
  }
});

// DELETE /api/safe-places/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const [result] = await db.pool.execute(
      'DELETE FROM safe_places WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Lieu non trouvé' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Safe places DELETE error:', err);
    res.status(500).json({ message: 'Erreur lors de la suppression' });
  }
});

module.exports = router;
