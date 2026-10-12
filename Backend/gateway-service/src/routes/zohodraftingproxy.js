/**
 * Zoho Drafting Proxy
 * 
 * Routes /api/drafting/* requests to the Drafting Service
 * 
 * - Protected by authMiddleware (JWT validation at gateway)
 * - Draftingservice performs independent JWT validation
 * - Path rewrite: /api/drafting/* → /*
 */

const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware, injectProxyUserHeaders } = require("../middlewares/authMiddleware");

const router = express.Router();

// Target URL for drafting service
const targetDrafting = process.env.ZOHO_DRAFTING_SERVICE_URL || "http://localhost:5006";

console.log(`[GATEWAY] Zoho Drafting Service target: ${targetDrafting}`);

// Log incoming requests
router.use("/", (req, res, next) => {
    console.log(`[Gateway] Zoho Drafting request: ${req.method} ${req.originalUrl}`);
    next();
});

// Protect all routes with JWT
router.use("/", authMiddleware);

// Proxy: /api/drafting/* → Drafting Service /*
router.use(
    "/",
    createProxyMiddleware({
        target: targetDrafting,
        changeOrigin: true,
        pathRewrite: (path) => {
            // Path arrives without /api/drafting prefix (already stripped by router mount)
            // Forward as-is to drafting service root
            console.log(`[Gateway] Zoho Drafting path rewrite: ${path} → ${path}`);
            return path;
        },
        onProxyReq: (proxyReq, req) => {
            injectProxyUserHeaders(proxyReq, req);
            if (req.headers["x-firm-id"]) {
                proxyReq.setHeader("x-firm-id", req.headers["x-firm-id"]);
            }
            console.log(`[Gateway] Proxying to Drafting Service: ${proxyReq.path}`);
        },
        logLevel: "debug",
        proxyTimeout: 120000, // 2 minutes for document operations
        timeout: 120000,
        onError: (err, req, res) => {
            console.error(`[Gateway] Zoho Drafting proxy error: ${err.message}`);
            res.status(502).json({
                success: false,
                error: "Drafting Service is unavailable",
                message: err.message
            });
        },
    })
);

module.exports = router;