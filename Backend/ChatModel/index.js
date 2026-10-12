const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initializeGCS } = require('./config/gcs');
const { checkSystemClock } = require('./utils/systemCheck');

checkSystemClock().then(clockStatus => {
  if (!clockStatus.synchronized && clockStatus.differenceMinutes) {
    console.error(`\n⚠️ CRITICAL: System clock is out of sync by ${clockStatus.differenceMinutes.toFixed(2)} minutes!`);
    console.error('   This will cause JWT authentication errors with GCS.');
    console.error('   Please sync your system clock before using GCS features.\n');
  }
});

try {
  initializeGCS();
} catch (error) {
  console.error('⚠️ Warning: GCS initialization failed. File uploads will not work:', error.message);
  console.error('   Run: node scripts/test-gcs-credentials.js to diagnose the issue');
}

const chatRoutes = require('./routes/chatRoutes');

const app = express();
const PORT = process.env.PORT || 5003;

// Central error capture (docs/error-logging.md). Vendored copy: ./errorlog
const errorlog = require('./errorlog');
errorlog.install(app, { serviceName: 'chatmodel', root: __dirname });

// Must not use Access-Control-Allow-Origin: * with credentialed requests.
// Keep known production and local origins enabled even if Cloud Run env vars drift.
const defaultCorsOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5173',
  'https://ailearn.co.in',
  'https://www.ailearn.co.in',
  'https://nexintelagent.netlify.app',
];

const envCorsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

const corsOrigins = [...new Set([...defaultCorsOrigins, ...envCorsOrigins])];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);
app.options(/.*/, cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ChatModel service is running',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/chat', chatRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Record every error before the existing handler answers (format unchanged)
app.use(errorlog.errorHandler({ passThrough: true }));

app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 ChatModel service running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;

