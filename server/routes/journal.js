const express = require('express');
const db = require('../config/baseDonnees');
const authenticate = require('../middleware/authentification');

const router = express.Router();

// GET /api/journal/health — vérifier que la route journal est chargée
router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'journal' });
});

// GET /api/journal — liste des entrées du journal (plus récentes en premier)
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await db.pool.execute(
      `SELECT id, content, created_at, updated_at
       FROM journal_entries
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ entries: rows });
  } catch (err) {
    console.error('Journal GET error:', err);
    res.status(500).json({ message: 'Erreur lors de la récupération du journal' });
  }
});

// POST /api/journal — créer une entrée
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ message: 'Le contenu est requis' });
    }
    const [result] = await db.pool.execute(
      'INSERT INTO journal_entries (user_id, content) VALUES (?, ?)',
      [userId, content.trim()]
    );
    const [rows] = await db.pool.execute(
      'SELECT id, content, created_at, updated_at FROM journal_entries WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Journal POST error:', err);
    res.status(500).json({ message: 'Erreur lors de l\'enregistrement' });
  }
});

// PUT /api/journal/:id — modifier une entrée
router.put('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ message: 'Le contenu est requis' });
    }
    const [result] = await db.pool.execute(
      'UPDATE journal_entries SET content = ? WHERE id = ? AND user_id = ?',
      [content.trim(), id, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Entrée introuvable' });
    }
    const [rows] = await db.pool.execute(
      'SELECT id, content, created_at, updated_at FROM journal_entries WHERE id = ?',
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Journal PUT error:', err);
    res.status(500).json({ message: 'Erreur lors de la modification' });
  }
});

// DELETE /api/journal/:id — supprimer une entrée
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);
    const [result] = await db.pool.execute(
      'DELETE FROM journal_entries WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Entrée introuvable' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Journal DELETE error:', err);
    res.status(500).json({ message: 'Erreur lors de la suppression' });
  }
});

module.exports = router;
