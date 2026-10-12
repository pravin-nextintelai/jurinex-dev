const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

// Initialize database connection (only for documents, not user data)
require('./config/db');

// Import routes
const authRoutes = require('./routes/auth.routes');
const documentRoutes = require('./routes/document.routes');
const wordRoutes = require('./routes/word.routes');

const app = express();
const PORT = process.env.PORT || 4000;

// Central error capture (docs/error-logging.md). Vendored copy: ./errorlog
const errorlog = require('./errorlog');
errorlog.install(app, { serviceName: 'draft-service', root: __dirname });

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173',
      "https://ailearn.co.in",
      "https://www.ailearn.co.in",
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'Draft Service is running',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint - for gateway proxy
// Only return service info if no token is provided (health check)
app.get('/', (req, res) => {
  // If token is in query, this might be a misrouted request - log it
  if (req.query.token) {
    console.warn('[draft-service] ⚠️ Received request to root (/) with token - this might be a routing issue');
    console.warn('[draft-service] Expected path: /api/auth/signin');
    console.warn('[draft-service] Query params:', Object.keys(req.query));
  }
  res.json({ 
    service: 'Draft Service',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      documents: '/api/documents',
      word: '/api/word'
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/word', wordRoutes);

// Handle /word requests (likely browser resource requests) - return simple response to prevent 404
app.get('/word', (req, res) => {
  console.log('[draft-service] Received /word request - likely browser resource, returning service info');
  res.json({ 
    message: 'Word API endpoint',
    endpoint: '/api/word',
    note: 'Use /api/word/* for Word operations'
  });
});

// Record every error before the existing handler answers (format unchanged)
app.use(errorlog.errorHandler({ passThrough: true }));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON payload' });
  }
  
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Draft Service running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Frontend URL: ${process.env.FRONTEND_URL}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully.');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received. Shutting down gracefully.');
  process.exit(0);
});

module.exports = app;
