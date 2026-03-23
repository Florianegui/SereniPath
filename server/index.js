const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const db = require('./config/baseDonnees');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/authentification'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/density', require('./routes/densite'));
app.use('/api/routes', require('./routes/itineraires'));
app.use('/api/advice', require('./routes/conseils'));
app.use('/api/stats', require('./routes/statistiques'));
app.use('/api/mood', require('./routes/humeur'));
try {
  app.use('/api/journal', require('./routes/journal'));
} catch (e) {
  console.error('Failed to load journal routes:', e);
}
app.use('/api/ml', require('./routes/ml'));
app.use('/api/gamification', require('./routes/gamification'));
app.use('/api/premium', require('./routes/premium'));
app.use('/api/sentiment', require('./routes/sentiment'));
app.use('/api/safe-places', require('./routes/lieuxSecurisants'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Zénova API is running' });
});

// Initialize database
db.initialize()
  .then(() => {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Database initialization failed:', err);
    process.exit(1);
  });

module.exports = app;
