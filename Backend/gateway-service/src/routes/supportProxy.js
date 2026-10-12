const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware, injectProxyUserHeaders } = require("../middlewares/authMiddleware");

const router = express.Router();
const supportTarget = process.env.SUPPORT_SERVICE_URL || "http://localhost:5004";

router.use((req, res, next) => {
  console.log("[Gateway][SupportProxy] Incoming request", {
    method: req.method,
    originalUrl: req.originalUrl,
    path: req.path,
    target: supportTarget,
    hasAuthHeader: Boolean(req.headers.authorization),
    userId: req.user?.id || null,
  });
  next();
});

router.use(authMiddleware);

router.use(
  "/",
  createProxyMiddleware({
    target: supportTarget,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      const rewrittenPath = `/api/support${path.startsWith("/") ? path : `/${path}`}`;
      console.log("[Gateway][SupportProxy] Path rewrite", {
        incomingPath: path,
        rewrittenPath,
        originalUrl: req.originalUrl,
      });
      return rewrittenPath;
    },
    logLevel: "debug",
    onProxyReq: (proxyReq, req) => {
      injectProxyUserHeaders(proxyReq, req);
      console.log("[Gateway][SupportProxy] Forwarding request", {
        method: req.method,
        originalUrl: req.originalUrl,
        proxiedPath: proxyReq.path,
        target: supportTarget,
        userId: req.user?.id || null,
        accountType: req.user?.account_type || null,
      });
    },
    onProxyRes: (proxyRes, req) => {
      console.log("[Gateway][SupportProxy] Response received", {
        method: req.method,
        originalUrl: req.originalUrl,
        statusCode: proxyRes.statusCode,
      });
    },
    onError: (err, req, res) => {
      console.error("[Gateway][SupportProxy] Proxy error", {
        method: req.method,
        originalUrl: req.originalUrl,
        target: supportTarget,
        message: err.message,
      });
      res.status(500).json({ error: "Support Service is unavailable" });
    },
  })
);

module.exports = router;
