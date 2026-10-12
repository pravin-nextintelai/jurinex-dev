
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();
console.log(`[Gateway] PAYMENT_SERVICE_URL: ${process.env.PAYMENT_SERVICE_URL}`);
console.log(`[Gateway] Gateway Port: ${process.env.PORT || 5000}`);

const {
  createProxyMiddleware,
  legacyCreateProxyMiddleware,
} = require("http-proxy-middleware");
const axios = require("axios");
const { authMiddleware, injectProxyUserHeaders } = require("./middlewares/authMiddleware");
const authProxy = require("./routes/authProxy");
const fileProxy = require("./routes/fileProxy");
// const paymentProxy = require("./routes/paymentProxy");
const paymentProxy = require("./routes/paymentProxy");
const supportProxy = require("./routes/supportProxy");
const draftProxy = require("./routes/draftProxy");
const msdraftProxy = require("./routes/msdraftProxy");
const visualProxy = require("./routes/visualProxy");
const chatProxy = require("./routes/chatProxy");
const zohodraftingproxy = require("./routes/zohodraftingproxy");
const draftingTemplateProxy = require("./routes/draftingTemplateProxy");
const draftingAiProxy = require("./routes/draftingAiProxy");
const templateAnalyzerProxy = require("./routes/templateAnalyzerProxy");

const app = express();

// Central error capture (docs/error-logging.md). Vendored copy: ../errorlog
const errorlog = require("../errorlog");
errorlog.install(app, { serviceName: "gateway-service", root: require("path").resolve(__dirname, "..") });

// Global JSON parsing removed to prevent breaking proxies. Applied to specific direct routes.
// Target URL for auth service
const targetAuth = process.env.AUTH_SERVICE_URL || "http://localhost:5001";

// ✅ Update allowed origins for frontend + local dev
const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean)
    : [
        "http://localhost:5173", // Vite dev server
        "http://localhost:5000", // local testing
        "http://localhost:8000", // HTTP server for test pages
        "http://localhost:3000", // Alternative test server
        "http://127.0.0.1:8000", // HTTP server (alternative)
        "http://127.0.0.1:3000", // Alternative test server
        "https://nexintel.netlify.app", // production frontend
        "https://jurinex.netlify.app",
        "https://jurinex-dev.netlify.app",
        "https://ailearn.co.in",
        "https://www.ailearn.co.in",
      ]
);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like Postman, curl, or file:// protocol)
    if (!origin) return callback(null, true);

    // Allow requests from allowed origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // For development: allow localhost with any port
    if (origin && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true, // if sending cookies
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization", "x-user-id", "X-Google-Access-Token"]
}));


// Simple logger to see incoming requests
app.use((req, res, next) => {
  console.log(`[Gateway] Incoming Request: ${req.method} ${req.originalUrl}`);
  console.log(`[Gateway] Request Path: ${req.path}`);
  console.log(`[Gateway] Request Base URL: ${req.baseUrl}`);
  console.log(`[Gateway] Has Auth Header: ${!!req.headers.authorization}`);
  next();
});

// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "API Gateway is running" });
});

// Google OAuth callbacks — Google redirects with query params. http-proxy-middleware v3 can
// rewrite paths to "/callback/?query" (extra slash) and upstream returns 404; legacy middleware
// restores v2 req.url behavior. See https://github.com/chimurai/http-proxy-middleware/issues/1016
const googleOAuthProxyOpts = {
  target: targetAuth,
  changeOrigin: true,
  onProxyReq: (proxyReq, req) => {
    console.log(`[GATEWAY] Google OAuth proxy → ${targetAuth}${req.originalUrl}`);
  },
  onProxyRes: (proxyRes) => {
    console.log(`[GATEWAY] Google OAuth upstream status: ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error("[GATEWAY] Google OAuth proxy error:", err.message);
    if (!res.headersSent) {
      res.status(502).send("Bad Gateway - auth service unreachable");
    }
  },
};

app.use(
  legacyCreateProxyMiddleware("/api/auth/google/callback", googleOAuthProxyOpts)
);
app.use(
  legacyCreateProxyMiddleware("/api/auth/google/drive/callback", googleOAuthProxyOpts)
);

// ✅ Universal auth forwarder using axios
// Express 5's body parser consumes the request stream before http-proxy-middleware
// can forward it, causing ALL POST/PUT/PATCH requests through the proxy to hang.
app.use(["/api/auth", "/api/rbac"], express.json({ limit: '10mb' }), async (req, res) => {
  // Google OAuth callback is already handled above via proxy (GET with no body — works fine)
  const authPath = req.originalUrl; // e.g. /api/auth/login, /api/auth/professional-profile
  const authUrl = `${targetAuth}${authPath}`;
  const method = req.method.toLowerCase();

  console.log(`[Gateway] Auth forwarder: ${req.method} ${authPath} → ${authUrl}`);

  try {
    // Build headers to forward
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }
    if (req.headers['x-user-id']) {
      headers['x-user-id'] = req.headers['x-user-id'];
    }
    // Device-session tracking needs the real client, not the gateway: forward the
    // browser's User-Agent and append our view of the client IP to X-Forwarded-For.
    if (req.headers['user-agent']) {
      headers['User-Agent'] = req.headers['user-agent'];
    }
    const clientIp = req.headers['x-forwarded-for']
      ? `${req.headers['x-forwarded-for']}, ${req.ip}`
      : (req.ip || req.socket?.remoteAddress || '');
    if (clientIp) {
      headers['X-Forwarded-For'] = clientIp;
    }

    const axiosConfig = { method, url: authUrl, headers };

    // Forward body for methods that have one
    if (['post', 'put', 'patch'].includes(method) && req.body && Object.keys(req.body).length > 0) {
      axiosConfig.data = req.body;
    }

    const response = await axios(axiosConfig);
    res.status(response.status).json(response.data);
  } catch (error) {
    const isPing = authPath.includes('/activity/ping');
    if (isPing && error.response?.status && error.response.status < 500) {
      // Ping is fire-and-forget — a 4xx (expired token, not found) is not worth an error log
      console.log(`[Gateway] Ping silenced (${error.response.status}): ${authPath}`);
      return res.status(200).json({ success: true, silenced: true });
    }
    console.error(`[Gateway] Auth forwarder error (${req.method} ${authPath}):`, error.message);
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    res.status(502).json({
      success: false,
      error: "Authentication service unavailable",
      message: error.message
    });
  }
});

// Note: authProxy is no longer needed — all /api/auth/* routes are handled above
app.use(fileProxy);

// User-resources always proxy to payment-service (real plan data after checkout).
app.use(paymentProxy);

// Optional fallback only when payment microservice is unreachable (SKIP_PAYMENT_SERVICE=true).
if (process.env.SKIP_PAYMENT_SERVICE === "true") {
  console.log(
    "[Gateway] SKIP_PAYMENT_SERVICE=true — user-resources fallback forwarder enabled"
  );
  app.use(require("./routes/mockUserResourcesRoutes"));
}
app.use("/support", supportProxy);
// Mount msdraftProxy FIRST to handle Microsoft Word auth routes (token in query)
// This must come before draftProxy to catch auth routes
app.use("/drafting", msdraftProxy);
// Mount draftProxy for Google Docs routes (different service/port)
app.use("/drafting", draftProxy);
app.use(visualProxy); // Visual Service proxy for flowchart generation
app.use(chatProxy); // ChatModel Service proxy for document Q&A
app.use("/api/drafting", zohodraftingproxy); // Zoho Drafting Service proxy
app.use("/api/drafting-templates", draftingTemplateProxy); // Drafting Template Service proxy
app.use("/api/drafting-ai", draftingAiProxy); // Drafting AI proxy (ChatModel)
app.use("/api/template-analysis", templateAnalyzerProxy); // Template Analyzer Service proxy

// Direct route for /api/drafts → Drafting Template Service
const targetDraftingTemplate = process.env.DRAFTING_TEMPLATE_SERVICE_URL || "http://localhost:5010";

app.use("/api/drafts", authMiddleware, createProxyMiddleware({
  target: targetDraftingTemplate,
  changeOrigin: true,
  pathRewrite: (path, req) => {
    // When mounted at /api/drafts, Express strips the prefix
    // So /api/drafts becomes /, /api/drafts/:id becomes /:id
    // We need to prepend /api/drafts back to the path
    const rewrittenPath = `/api/drafts${path}`;
    console.log(`[Gateway] Drafts API path rewrite: ${path} → ${rewrittenPath}`);
    return rewrittenPath;
  },
  onProxyReq: (proxyReq, req) => {
    injectProxyUserHeaders(proxyReq, req);
    if (req.headers["x-firm-id"]) {
      proxyReq.setHeader("x-firm-id", req.headers["x-firm-id"]);
    }
    console.log(`[Gateway] Proxying /api/drafts to Drafting Template Service: ${proxyReq.path}`);
  },
  logLevel: "debug",
  proxyTimeout: 120000,
  timeout: 120000,
  onError: (err, req, res) => {
    console.error(`[Gateway] Drafts API proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        error: "Drafting Template Service is unavailable",
        message: err.message
      });
    }
  },
}));

// app.use(userResourcesProxy);

// Catch-all for 404 errors
app.use((req, res, next) => {
  console.log(`[Gateway] 404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
});

// Record every error before the existing handler answers (format unchanged)
app.use(errorlog.errorHandler({ passThrough: true }));

// General error handler
app.use((err, req, res, next) => {
  console.error("[Gateway] Unhandled Error:", err.stack);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

module.exports = app;


