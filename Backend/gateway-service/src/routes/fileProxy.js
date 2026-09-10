const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const axios = require("axios");
const { authMiddleware } = require("../middlewares/authMiddleware");
const { resolveChatServiceTarget } = require("../utils/chatServiceTarget");

const router = express.Router();

// Debug log before proxying
router.use("/files", (req, res, next) => {
  console.log("Gateway received:", req.method, req.originalUrl);
  next();
});

// Protect all /files routes with JWT
router.use("/files", authMiddleware);
router.use("/docs", authMiddleware);
router.use("/mindmap", authMiddleware);

// For secrets list: resolve user's active plan from payment service and inject as header
// Runs after authMiddleware (req.user is available), before the proxy forwards the request
router.get("/files/secrets", async (req, res, next) => {
  const userId = req.user?.id;
  if (userId) {
    const paymentUrl = (process.env.PAYMENT_SERVICE_URL || "http://localhost:5003").replace(/\/$/, "");
    try {
      const resp = await axios.get(
        `${paymentUrl}/api/user-resources/user-plan/${userId}`,
        { headers: { Authorization: req.headers.authorization }, timeout: 3000 }
      );
      const planData = resp.data?.data ?? resp.data ?? null;
      const planId = planData?.plan_id ?? planData?.id ?? null;
      if (planId != null) {
        req.headers["x-user-plan-id"] = String(planId);
        console.log(`[Gateway] Injected x-user-plan-id=${planId} for user ${userId}`);
      }
    } catch (err) {
      console.warn(`[Gateway] Plan lookup failed for user ${userId}: ${err.message} — proceeding without plan filter`);
    }
  }
  next();
});

// Analysis prompts: agentic-chat-service implements the same /secrets contract
// and is the service used for /chat. Proxying here avoids 504s when
// agentic-document-service (FILE_SERVICE_URL :8092) is not running.
const chatServiceTarget = resolveChatServiceTarget();

router.use(
  "/files/secrets",
  createProxyMiddleware({
    target: chatServiceTarget,
    changeOrigin: true,
    // Express hands us the remainder after the mount point, so a bare list
    // request arrives as "/?fetch=false". Drop that lone slash: FastAPI treats
    // "/api/chat/secrets/" as a different (unrouted) path.
    pathRewrite: (path) => {
      const rest = String(path || "").replace(/^\/(?=\?|$)/, "");
      return `/api/chat/secrets${rest}`;
    },
    onProxyReq: (proxyReq, req) => {
      if (req.user?.id) {
        proxyReq.setHeader("x-user-id", String(req.user.id));
      }
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
      if (req.headers["x-user-plan-id"]) {
        proxyReq.setHeader("x-user-plan-id", req.headers["x-user-plan-id"]);
      }
      console.log(`[Gateway] Proxying secrets to ChatModel: ${proxyReq.path} (plan=${req.headers["x-user-plan-id"] ?? "none"})`);
    },
    proxyTimeout: 30000,
    timeout: 30000,
    onError: (err, req, res) => {
      console.error("[Gateway] Secrets (ChatModel) proxy error:", err.message);
      if (!res.headersSent) {
        res.status(502).json({
          error: "Analysis prompts service is unavailable",
          message: err.message,
        });
      }
    },
  })
);

// Proxy: /files/* → File Service /api/files/*
router.use(
  "/files",
  createProxyMiddleware({
    target: process.env.FILE_SERVICE_URL || "http://localhost:8092",
    changeOrigin: true,
    pathRewrite: {
      "^/": "/api/files/", // Rewrite /files/* to /api/files/*
    },
    onProxyReq: (proxyReq, req) => {
      // Inject user ID from JWT into header for Document Service
      if (req.user && req.user.id) {
        proxyReq.setHeader("x-user-id", req.user.id);
      }
      // Forward plan id resolved by the plan-lookup middleware above
      if (req.headers["x-user-plan-id"]) {
        proxyReq.setHeader("x-user-plan-id", req.headers["x-user-plan-id"]);
      }
    },
    logLevel: "debug", // shows proxy details
    proxyTimeout: 120000, // 2 minutes for file uploads
    timeout: 120000,
    onError: (err, req, res) => {
      console.error("File service proxy error:", err.message);
      res.status(500).json({ error: "File Service is unavailable" });
    },
  })
);

// Proxy: /docs/* → File Service /api/files/*
router.use(
  "/docs",
  createProxyMiddleware({
    target: process.env.FILE_SERVICE_URL || "http://localhost:8092",
    changeOrigin: true,
    pathRewrite: {
      "^/": "/api/files/", // Rewrite /docs/* to /api/files/*
    },
    onProxyReq: (proxyReq, req) => {
      // Inject user ID from JWT into header for Document Service
      if (req.user && req.user.id) {
        proxyReq.setHeader("x-user-id", req.user.id);
      }
      // Forward Authorization header for Google Drive service-to-service calls
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
      console.log(`[Gateway] Proxying docs request to: /api/files${req.url}`);
    },
    logLevel: "debug", // shows proxy details
    proxyTimeout: 120000, // 2 minutes for file uploads
    timeout: 120000,
    onError: (err, req, res) => {
      console.error("File service proxy error:", err.message);
      res.status(500).json({ error: "File Service is unavailable" });
    },
  })
);

// Proxy: /mindmap/* → File Service /api/mindmap/*
router.use(
  "/mindmap",
  createProxyMiddleware({
    target: process.env.FILE_SERVICE_URL || "http://localhost:8092",
    changeOrigin: true,
    pathRewrite: (path) => {
      // When router matches /mindmap, the remaining path (e.g., /files) is passed here
      // So we need to prefix it with /api/mindmap
      const rewritten = `/api/mindmap${path}`;
      console.log(`[Gateway] Rewriting mindmap path: ${path} -> ${rewritten}`);
      return rewritten;
    },
    onProxyReq: (proxyReq, req) => {
      // Inject user ID from JWT into header for Document Service
      if (req.user && req.user.id) {
        proxyReq.setHeader("x-user-id", req.user.id);
      }
      // Forward Authorization header
      if (req.headers.authorization) {
        proxyReq.setHeader("Authorization", req.headers.authorization);
      }
      console.log(`[Gateway] Proxying mindmap request to: ${proxyReq.path}`);
    },
    logLevel: "debug", // shows proxy details
    proxyTimeout: 120000, // 2 minutes for file uploads and mindmap generation
    timeout: 120000,
    onError: (err, req, res) => {
      console.error("Mindmap service proxy error:", err.message);
      res.status(500).json({ error: "Mindmap Service is unavailable" });
    },
  })
);

module.exports = router;
