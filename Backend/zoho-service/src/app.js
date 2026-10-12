/**
 * Express Application Setup
 * Production-ready configuration
 * 
 * NOTE: Legacy drafting routes have been REMOVED.
 * Only Office Integrator routes (/drafting/oi/*) are active.
 */
const express = require('express');
const cors = require('cors');
const { requestLogger } = require('./middlewares/requestLogger');
const { errorHandler, notFound } = require('./middlewares/errorHandler');
const oiRoutes = require('./routes/oiRoutes');
const { PROCESS_INSTANCE_ID } = require('./utils/logger');

const app = express();

// Central error capture (docs/error-logging.md). Vendored copy: ../errorlog
const errorlog = require('../errorlog');
errorlog.install(app, { serviceName: 'zoho-service', root: require('path').resolve(__dirname, '..') });

// CORS configuration
const allowedOrigins = [
    'https://jurinex.netlify.app',
    'https://jurinex-dev.netlify.app',
    'http://localhost:5173',
    'http://localhost:3000'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

// Handle preflight
app.options('*', cors());

// Parse JSON (skip for multipart - handled by busboy)
app.use((req, res, next) => {
    if (req.headers['content-type']?.includes('multipart/form-data')) {
        return next();
    }
    express.json({ limit: '10mb' })(req, res, next);
});

// Request logging middleware
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'Drafting Service is running',
        instance: PROCESS_INSTANCE_ID,
        uptime: process.uptime()
    });
});

// Office Integrator routes (ONLY active Zoho integration)
app.use('/drafting/oi', oiRoutes);

// 404 handler
app.use(notFound);

// Record every error before the existing handler answers (format unchanged)
app.use(errorlog.errorHandler({ passThrough: true }));

// Error handler
app.use(errorHandler);

module.exports = app;
