
const { createProxyMiddleware } = require("http-proxy-middleware");
const express = require("express");
const { authMiddleware, injectProxyUserHeaders } = require("../middlewares/authMiddleware");

const router = express.Router();

// Log all incoming Payment requests
router.use("/payments", (req, res, next) => {
  console.log("Gateway received Payment request:", req.method, req.originalUrl);
  next();
});

// Proxy for /payments/* → Payment Service /api/payments/*
router.use(
  "/payments",
  authMiddleware, // protect subscription routes; optional for /plans if you want it public
  createProxyMiddleware({
    target: process.env.PAYMENT_SERVICE_URL || "http://localhost:5003",
    changeOrigin: true,
    pathRewrite: (path) => {
      // req.path is already without /payments, so just prefix with /api/payments
      const rewritten = `/api/payments${path}`;
      console.log(`[Gateway] Rewriting path: ${path} -> ${rewritten}`);
      return rewritten;
    },
    logLevel: "debug",
    onProxyReq: (proxyReq, req) => {
      injectProxyUserHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error("Payment service proxy error:", err.message);
      res.status(500).json({ error: "Payment Service is unavailable" });
    },
    proxyTimeout: 120000,
    timeout: 120000,
  })
);

// Log all incoming User Resources requests
router.use("/user-resources", (req, res, next) => {
  console.log("Gateway received User Resources request:", req.method, req.originalUrl);
  next();
});

// Proxy for /user-resources/* → Payment Service /api/user-resources/*
router.use(
  "/user-resources",
  authMiddleware, // Protect user resource routes
  createProxyMiddleware({
    target: process.env.PAYMENT_SERVICE_URL || "http://localhost:5003",
    changeOrigin: true,
    pathRewrite: (path) => {
      // req.path is already without /user-resources, so just prefix with /api/user-resources
      const rewritten = `/api/user-resources${path}`;
      console.log(`[Gateway] Rewriting path: ${path} -> ${rewritten}`);
      return rewritten;
    },
    logLevel: "debug",
    onProxyReq: (proxyReq, req) => {
      injectProxyUserHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error("User Resources service proxy error:", err.message);
      res.status(500).json({ error: "Payment Service is unavailable" });
    },
    proxyTimeout: 120000,
    timeout: 120000,
  })
);

module.exports = router;

