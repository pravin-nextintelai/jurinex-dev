




const express = require('express');
const morgan = require('morgan');
const cors = require('cors');

// Load .env only for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: './.env' });
}

const draftRoutes = require('./routes/draftRoutes');
const { handleGoogleDriveWebhook } = require('./controllers/webhookController');

const app = express();

// Central error capture (docs/error-logging.md). Vendored copy: ./errorlog
const errorlog = require('./errorlog');
errorlog.install(app, { serviceName: 'drafting-service', root: __dirname });

/* ===============================
   MIDDLEWARE
================================= */

app.use(express.json());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

/* ===============================
   WEBHOOK ROUTE (Before CORS)
================================= */

app.post('/api/webhooks/google-drive', handleGoogleDriveWebhook);

/* ===============================
   CORS CONFIGURATION
================================= */

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5000',
  'https://jurinex-production.netlify.app',
  'https://microservicefrontend.netlify.app',
  'https://jurinex-dev.netlify.app',
  'https://ailearn.co.in',
  'https://www.ailearn.co.in',
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    if (
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:')
    ) {
      return callback(null, true);
    }

    if (
      origin.includes('googleapis.com') ||
      origin.includes('google.com')
    ) {
      return callback(null, true);
    }

    return callback(new Error(`CORS: Origin ${origin} Not Allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  credentials: true,
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'x-user-id',
    'X-Google-Access-Token',
    'x-goog-resource-id',
    'x-goog-resource-state',
    'x-goog-resource-uri',
    'x-goog-channel-id',
    'x-goog-channel-expiration'
  ]
}));

/* ===============================
   ROOT ROUTE
================================= */

app.get('/', (req, res) => {
  res.status(200).send('🚀 Drafting Service Running');
});

/* ===============================
   API ROUTES
================================= */

app.use('/api/drafts', draftRoutes);

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'drafting-service',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/test-route', (req, res) => {
  res.send('✅ Drafting Service test route is working!');
});

/* ===============================
   ERROR HANDLER
================================= */

// Record every error before the existing handler answers (format unchanged)
app.use(errorlog.errorHandler({ passThrough: true }));

app.use((err, req, res, next) => {
  console.error('❌ ERROR:', err.stack);

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

/* ===============================
   SERVER START (CLOUD RUN SAFE)
================================= */

// Keep your local port (5005)
// Cloud Run will override with 8080 automatically
const PORT = process.env.PORT || 5005;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Drafting Service running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
});

/* ===============================
   GRACEFUL SHUTDOWN
================================= */

process.on('unhandledRejection', (err) => {
  console.error(`❌ Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully.');
  server.close(() => {
    console.log('✅ Server closed.');
  });
});

module.exports = app;
