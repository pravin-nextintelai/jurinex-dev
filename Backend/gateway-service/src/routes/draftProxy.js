const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware, injectProxyUserHeaders } = require("../middlewares/authMiddleware");

const router = express.Router();

// CRITICAL: Only handle Google Docs routes, NOT Microsoft Word routes
// Google Docs routes: /api/drafts/*
// Microsoft Word routes: /api/auth/*, /api/documents/*, /api/word/* should be handled by msdraftProxy.js
router.use((req, res, next) => {
  const isGoogleDocsRoute = req.path.startsWith('/api/drafts');
  
  if (!isGoogleDocsRoute) {
    // NOT a Google Docs route - this shouldn't happen if msdraftProxy is working correctly
    // But if it does, return 404
    console.log('[Gateway Draft Proxy] ⏭️  NOT a Google Docs route, returning 404:', req.path);
    return res.status(404).json({ 
      error: 'Route not found',
      message: `Route ${req.path} is not a Google Docs route. Use /api/drafts/* for Google Docs.`
    });
  }
  
  // IS a Google Docs route - continue processing
  console.log("[Gateway Draft Proxy] Received Google Docs route:", req.method, req.originalUrl, "Query:", req.query);
  next();
});

// Protect all Google Docs routes with auth middleware
router.use(authMiddleware);

// Proxy: /drafting/api/drafts/* → Drafting Service /api/drafts/*
// When mounted at /drafting, request /drafting/api/drafts/initiate becomes /api/drafts/initiate here
// IMPORTANT: Always target the drafting-service (Google Docs) on port 5005
const DRAFTING_SERVICE_TARGET = process.env.DRAFTING_SERVICE_URL || "http://localhost:5005";
// Ensure it's not pointing to gateway (port 5000) or draft-service (port 4000)
const finalTarget = (DRAFTING_SERVICE_TARGET.includes('5000') || DRAFTING_SERVICE_TARGET.includes('4000')) 
  ? "http://localhost:5005" 
  : DRAFTING_SERVICE_TARGET;
console.log("[Gateway Draft Proxy] Target configured:", finalTarget, "(from env:", process.env.DRAFTING_SERVICE_URL, ")");

router.use(
  "/",
  createProxyMiddleware({
    target: finalTarget,
    changeOrigin: true,
    // No path rewrite needed - the path (/api/drafts/initiate) is already correct
    // Query parameters are automatically preserved by http-proxy-middleware
    logLevel: "debug",
    proxyTimeout: 60000,
    timeout: 60000,
    onProxyReq: (proxyReq, req) => {
      injectProxyUserHeaders(proxyReq, req);
      console.log(`[Gateway Draft Proxy] Forward: ${req.method} ${req.originalUrl} → ${finalTarget}${proxyReq.path}`);
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`[Gateway Draft Proxy] Response: ${req.method} ${req.originalUrl} → ${proxyRes.statusCode}`);
    },
    onError: (err, req, res) => {
      console.error("[Gateway Draft Proxy] Error:", {
        message: err.message,
        code: err.code,
        target: finalTarget,
        path: req.path,
        method: req.method
      });
      if (!res.headersSent) {
        res.status(503).json({ 
          error: "Drafting Service is unavailable",
          details: err.code === 'ECONNREFUSED' ? 'Connection refused - is the drafting-service running on port 5005?' : err.message
        });
      }
    },
  })
);

module.exports = router;
