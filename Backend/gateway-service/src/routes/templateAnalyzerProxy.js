/**
 * Template Analyzer Proxy
 * 
 * Routes /api/template-analysis/* requests to the Template Analyzer Service (User-Side)
 */

const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware, injectProxyUserHeaders } = require("../middlewares/authMiddleware");

const router = express.Router();

// Target URL for template analyzer service
const targetAnalyzer = process.env.TEMPLATE_ANALYZER_SERVICE_URL || "http://localhost:5017";

console.log(`[GATEWAY] Template Analyzer Service proxy enabled → ${targetAnalyzer}`);

// Log incoming requests
router.use("/", (req, res, next) => {
    console.log(`[Gateway] Template Analyzer request: ${req.method} ${req.originalUrl}`);
    next();
});

// Protect all routes with JWT (except health check if needed, but usually analysis needs auth)
router.use("/", (req, res, next) => {
    if (req.path.startsWith('/health')) {
        return next();
    }
    return authMiddleware(req, res, next);
});

// Proxy: /api/template-analysis/* → Template Analyzer Service /*
// Inject x-user-id header BEFORE proxying
router.use("/", (req, res, next) => {
    if (req.user) {
        const userId = req.user.id || req.user.userId || req.user.sub;
        if (userId) {
            req.headers["x-user-id"] = String(userId);
        }
        if (req.user.email) {
            req.headers["x-user-email"] = req.user.email;
        }
    }
    next();
});

router.use(
    "/",
    createProxyMiddleware({
        target: targetAnalyzer,
        changeOrigin: true,
        pathRewrite: (path, req) => {
            // The backend application has a router with prefix="/analysis"
            // So valid backend URLs are: /analysis/templates, /analysis/upload-template

            // The gateway mounts this proxy at "/api/template-analysis"
            // Incoming request to Gateway: /api/template-analysis/templates

            // We need to transform: /api/template-analysis/templates -> /analysis/templates

            // Use req.originalUrl to be safe
            const originalPath = req.originalUrl || '';
            const newPath = originalPath.replace('/api/template-analysis', '/analysis');

            console.log(`[Gateway] Template Analyzer path rewrite: ${originalPath} -> ${newPath}`);
            return newPath;
        },
        logLevel: "debug",
        onProxyReq: (proxyReq, req) => {
            injectProxyUserHeaders(proxyReq, req);
        },
        onError: (err, req, res) => {
            console.error(`[Gateway] Analyzer proxy error: ${err.message}`);
            res.status(502).json({
                success: false,
                error: "Template Analyzer Service is unavailable",
                message: err.message
            });
        },
    })
);

module.exports = router;
