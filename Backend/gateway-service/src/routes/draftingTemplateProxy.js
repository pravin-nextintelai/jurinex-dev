/**
 * Drafting Template Proxy
 * 
 * Routes /api/drafting-templates/* requests to the Drafting Template Service
 * 
 * Path rewrite examples:
 *   /api/drafting-templates/health → /health
 *   /api/drafting-templates/api/templates → /api/templates
 *   /api/drafting-templates/api/drafts → /api/drafts
 */

const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware, injectProxyUserHeaders } = require("../middlewares/authMiddleware");

const router = express.Router();

// Target URL for drafting template service
const targetDraftingTemplate = process.env.DRAFTING_TEMPLATE_SERVICE_URL || "http://localhost:5010";

console.log(`[GATEWAY] Drafting Template Service proxy enabled → ${targetDraftingTemplate}`);

// Log incoming requests
router.use("/", (req, res, next) => {
    console.log(`[Gateway] Drafting Template request: ${req.method} ${req.originalUrl}`);
    next();
});

// Protect all routes with JWT (except health check)
// router.use("/", (req, res, next) => {
//     // Allow health check without auth
//     if (req.path === '/health' || req.path === '/') {
//         return next();
//     }
//     return authMiddleware(req, res, next);
// });


router.use("/", (req, res, next) => {
    if (req.path.startsWith('/health')) {
        return next();
    }
    return authMiddleware(req, res, next);
});


// Proxy: /api/drafting-templates/* → Drafting Template Service /*
router.use(
    "/",
    createProxyMiddleware({
        target: targetDraftingTemplate,
        changeOrigin: true,
        pathRewrite: (path, req) => {
            // When mounted at /api/drafting-templates, req.path is relative
            // e.g., /health, /api/templates, /api/drafts/:id
            // We want to forward as-is since the service expects these paths
            console.log(`[Gateway] Drafting Template path: ${path} → ${path}`);
            return path;
        },
        onProxyReq: (proxyReq, req) => {
            injectProxyUserHeaders(proxyReq, req);
            if (req.headers["x-firm-id"]) {
                proxyReq.setHeader("x-firm-id", req.headers["x-firm-id"]);
            }
            console.log(`[Gateway] Proxying to Drafting Template Service: ${proxyReq.path}`);
        },
        logLevel: "debug",
        proxyTimeout: 120000,
        timeout: 120000,
        onError: (err, req, res) => {
            console.error(`[Gateway] Drafting Template proxy error: ${err.message}`);
            res.status(502).json({
                success: false,
                error: "Drafting Template Service is unavailable",
                message: err.message
            });
        },
    })
);

module.exports = router;