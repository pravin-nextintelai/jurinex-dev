// src/routes/chatProxy.js
const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { resolveChatServiceTarget } = require("../utils/chatServiceTarget");

const router = express.Router();

// Log all incoming Chat requests
router.use("/chat", (req, res, next) => {
  console.log("[Gateway] Chat service request:", req.method, req.originalUrl);
  console.log("[Gateway] Request path:", req.path);
  console.log("[Gateway] Request originalUrl:", req.originalUrl);
  next();
});

// Proxy for /chat/* → ChatModel Service /api/chat/*
router.use(
  "/chat",
  authMiddleware, // Protect chat routes with JWT
  createProxyMiddleware({
    target: resolveChatServiceTarget(),
    changeOrigin: true,
    pathRewrite: (path) => {
      // When router matches /chat, the remaining path (e.g., /ask) is passed here
      // So we need to prefix it with /api/chat
      const rewritten = `/api/chat${path}`;
      console.log(`[Gateway] Rewriting path: ${path} -> ${rewritten}`);
      return rewritten;
    },
    logLevel: "debug",
    onProxyReq: (proxyReq, req) => {
      // Forward Authorization header to ChatModel service
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
      // Inject user ID from JWT into header if available
      if (req.user && req.user.id) {
        proxyReq.setHeader("x-user-id", req.user.id);
      }
      console.log(`[Gateway] Proxying to ChatModel: ${proxyReq.path}`);
    },
    proxyTimeout: 120000, // 2 minutes for LLM responses
    timeout: 120000,
    onError: (err, req, res) => {
      console.error("[Gateway] Chat service proxy error:", err.message);
      res.status(502).json({ 
        success: false,
        error: "Chat Service is unavailable",
        message: err.message 
      });
    },
  })
);

module.exports = router;

