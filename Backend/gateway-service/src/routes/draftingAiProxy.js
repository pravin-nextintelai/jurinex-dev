/**
 * Drafting AI Proxy
 * 
 * Routes /api/drafting-ai/* requests to the ChatModel service
 * 
 * ⚠️ NEW FILE - Does not modify existing proxies
 */

const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware, injectProxyUserHeaders } = require("../middlewares/authMiddleware");

const router = express.Router();

// Target URL for ChatModel service (AI service)
const targetAiService = process.env.AI_SERVICE_URL || "http://localhost:5002";

console.log(`[GATEWAY] Drafting AI proxy target: ${targetAiService}`);

// Log incoming requests
router.use("/", (req, res, next) => {
    console.log(`[Gateway] Drafting AI request: ${req.method} ${req.originalUrl}`);
    next();
});

// Protect all routes with JWT
router.use("/", authMiddleware);

// Proxy: /api/drafting-ai/* → ChatModel /api/drafting-ai/*
router.use(
    "/",
    createProxyMiddleware({
        target: targetAiService,
        changeOrigin: true,
        pathRewrite: (path, req) => {
            // Keep the path as-is for drafting-ai
            const rewritten = path.replace(/^\/api\/drafting-ai/, '/api/drafting-ai');
            console.log(`[Gateway] Drafting AI path: ${path} → ${rewritten}`);
            return rewritten;
        },
        onProxyReq: (proxyReq, req) => {
            injectProxyUserHeaders(proxyReq, req);
            console.log(`[Gateway] Proxying to ChatModel AI: ${proxyReq.path}`);
        },
        logLevel: "debug",
        proxyTimeout: 60000, // 60 seconds for AI operations
        timeout: 60000,
        onError: (err, req, res) => {
            console.error(`[Gateway] Drafting AI proxy error: ${err.message}`);
            res.status(502).json({
                success: false,
                error: "AI Service is unavailable",
                message: err.message
            });
        },
    })
);

module.exports = router;