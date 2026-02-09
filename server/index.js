const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const db = require('./config/database');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/density', require('./routes/density'));
app.use('/api/routes', require('./routes/routes'));
app.use('/api/advice', require('./routes/advice'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/mood', require('./routes/mood'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'SereniPathh API is running' });
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
