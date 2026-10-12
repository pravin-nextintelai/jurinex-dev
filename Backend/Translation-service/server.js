const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config/env');
const translationRoutes = require('./routes/translationRoutes');
const logger = require('./utils/logger');

const app = express();

// Central error capture (docs/error-logging.md). Vendored copy: ./errorlog
const errorlog = require('./errorlog');
errorlog.install(app, { serviceName: 'translation-service', root: __dirname });

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Routes
app.use('/api/translation', translationRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Translation Service API',
    version: '1.0.0',
    endpoints: {
      health: '/api/translation/health',
      translate: '/api/translation/translate',
      download: '/api/translation/download/:filename',
    },
  });
});

// Record every error before the existing handler answers (format unchanged)
app.use(errorlog.errorHandler({ passThrough: true }));

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(err.status || 500).json({
    success: false,
    error: config.server.nodeEnv === 'production' 
      ? 'Internal server error' 
      : err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
  logger.info(`Translation Service running on port ${PORT}`, {
    environment: config.server.nodeEnv,
    projectId: config.googleCloud.projectId,
  });
});

module.exports = app;

