const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');

require('dotenv').config({ path: './.env' });
const db = require('./src/config/db');
const paymentRoutes = require('./src/routes/paymentRoutes');
const userResourceRoutes = require('./src/routes/userResourcesRoutes');
const userplanRoutes = require('./src/routes/userplanRoutes');
const storageRoutes = require('./src/routes/storageRoutes');
const webhookRoutes = require('./src/routes/webhookRoutes');
const { initializeFirmAnalyticsSchema } = require('./src/utils/firmAnalyticsDb');
const { applyMigrations } = require('./src/utils/applyMigrations');
const { startCronJobs } = require('./src/services/cronService');

const app = express();

// Central error capture (docs/error-logging.md). Vendored copy: ./errorlog
const errorlog = require('./errorlog');
errorlog.install(app, { serviceName: 'payment-service', root: __dirname });

app.use(cookieParser());

// Razorpay webhooks must see the RAW body (signature = HMAC-SHA256 over the exact bytes), so this is
// mounted before express.json(). Razorpay calls this URL directly (not through the gateway, which
// requires a user JWT): <payment-service public URL>/api/payments/webhooks/razorpay
app.use('/api/payments/webhooks', webhookRoutes);

app.use(express.json());
app.use(morgan('dev'));

// Routes must be after body parsing middleware
app.use('/api/user-resources', userResourceRoutes);
app.use('/api/plans', userplanRoutes);

const allowedOrigins = [
  'https://nexintelagent.netlify.app',
  'https://ailearn.co.in',
  'https://www.ailearn.co.in',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "X-User-ID",
  ]
}));
// Express/path-to-regexp in this setup rejects "*" route tokens.
// Use a regex matcher for global preflight handling.
app.options(/.*/, cors());

// Browser-reported checkout failures (Razorpay cancelled / failed / verify failed),
// stored in error_logs with the user's id. Served by the error-log module itself.
const { protect: protectForErrorReports } = require('./src/middleware/auth');
app.use('/api/payments/client-errors', protectForErrorReports, errorlog.clientErrorRouter());

app.use('/api/payments', paymentRoutes);
app.use('/api/storage',  storageRoutes);

app.get('/api/test-route', (req, res) => {
  res.send('Test route is working!');
});

app.get('/api/simple-test', (req, res) => {
  res.send('Simple test route is working!');
});

const PORT = process.env.PORT || process.env.PAYMENT_SERVICE_PORT || 5003;

// Record every error before the existing handler answers (format unchanged)
app.use(errorlog.errorHandler({ passThrough: true }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack || err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({
    success: false,
    message: err.message || 'Something broke!',
  });
});

async function applyDocumentDbMigrations() {
  const documentPool = require('./src/config/documentDb');
  const STORAGE_STATS_DDL = `
    CREATE TABLE IF NOT EXISTS user_storage_stats (
      user_id         VARCHAR(100)              NOT NULL,
      file_count      INTEGER                   NOT NULL DEFAULT 0,
      chat_count      INTEGER                   NOT NULL DEFAULT 0,
      embedding_count INTEGER                   NOT NULL DEFAULT 0,
      files_bytes     BIGINT                    NOT NULL DEFAULT 0,
      chat_bytes      BIGINT                    NOT NULL DEFAULT 0,
      question_bytes  BIGINT                    NOT NULL DEFAULT 0,
      embedding_bytes BIGINT                    NOT NULL DEFAULT 0,
      total_bytes     BIGINT                    NOT NULL DEFAULT 0,
      updated_at      TIMESTAMP WITH TIME ZONE  NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT user_storage_stats_pkey PRIMARY KEY (user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_storage_stats_total
      ON user_storage_stats (total_bytes DESC);
  `;
  try {
    await documentPool.query(STORAGE_STATS_DDL);
    console.log('[DocumentDB Migration] ✅ user_storage_stats');
  } catch (err) {
    console.error('[DocumentDB Migration] ❌ user_storage_stats:', err.message);
  }
}

app.listen(PORT, async () => {
  await applyMigrations();
  await applyDocumentDbMigrations();
  await initializeFirmAnalyticsSchema();
  startCronJobs();
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Application accessible at http://localhost:${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.error(`❌ Unhandled Rejection: ${err.message}`);
  process.exit(1);
});
