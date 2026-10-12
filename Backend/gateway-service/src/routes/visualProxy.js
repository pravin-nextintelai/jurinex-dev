/**
 * Visual Service Proxy
 * 
 * This proxy routes requests to the Visual Service (Python Flask application)
 * which handles flowchart generation from documents using Gemini 1.5 Flash.
 * 
 * Routes:
 * - /visual/* → Visual Service /api/visual/*
 * 
 * All routes require JWT authentication via authMiddleware
 */

const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware, injectProxyUserHeaders } = require("../middlewares/authMiddleware");

const router = express.Router();

// Debug log before proxying
router.use("/visual", (req, res, next) => {
  console.log("[Visual Proxy] Gateway received:", req.method, req.originalUrl);
  next();
});

// Protect all /visual routes with JWT authentication
router.use("/visual", authMiddleware);

// Proxy: /visual/* → Visual Service /api/visual/*
// Note: Express router strips /visual prefix, so pathRewrite receives paths like /generate-flowchart
router.use(
  "/visual",
  createProxyMiddleware({
    target: process.env.VISUAL_SERVICE_URL || "http://localhost:8081",
    changeOrigin: true,
    pathRewrite: {
      "^/": "/api/visual/", // Prepend /api/visual/ to paths after /visual is stripped
    },
    onProxyReq: (proxyReq, req) => {
      injectProxyUserHeaders(proxyReq, req);
      console.log(`[Visual Proxy] Proxying ${req.method} ${req.originalUrl} to Visual Service`);
    },
    onProxyRes: (proxyRes, req, res) => {
      // Log successful response
      console.log(`[Visual Proxy] Response from Visual Service: ${proxyRes.statusCode}`);
    },
    logLevel: "debug", // shows proxy details
    proxyTimeout: 120000, // 2 minutes timeout (flowchart generation can take time)
    timeout: 120000,
    onError: (err, req, res) => {
      console.error("[Visual Proxy] Visual Service proxy error:", err.message);
      res.status(500).json({ 
        error: "Visual Service is unavailable",
        message: "The flowchart generation service is currently unavailable. Please try again later."
      });
    },
  })
);

module.exports = router;

