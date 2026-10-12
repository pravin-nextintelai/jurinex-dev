const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();

const supportRoutes = require("./routes/supportRoutes");
const errorHandler = require("./middleware/errorHandler");
const { initializeSupportSchema } = require("./services/supportService");

const app = express();

// Central error capture (docs/error-logging.md). Vendored copy: ./errorlog
const errorlog = require("./errorlog");
errorlog.install(app, { serviceName: "support-service", root: __dirname });

function summarizeBody(body) {
  if (!body || typeof body !== "object") return body;
  const clone = { ...body };
  if (typeof clone.message === "string") {
    clone.message = `${clone.message.slice(0, 120)}${clone.message.length > 120 ? "..." : ""}`;
  }
  return clone;
}

const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [
        "http://localhost:5173",
        "http://localhost:5000",
        "https://jurinex-dev.netlify.app",
        "https://jurinex.netlify.app",
        "https://ailearn.co.in",
        "https://www.ailearn.co.in"
      ]
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "Content-Type", "Accept", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use((req, res, next) => {
  const startedAt = Date.now();
  console.log("[SupportService] Request received", {
    method: req.method,
    originalUrl: req.originalUrl,
    path: req.path,
    contentType: req.headers["content-type"] || null,
    hasAuthHeader: Boolean(req.headers.authorization),
    body: summarizeBody(req.body),
  });

  res.on("finish", () => {
    console.log("[SupportService] Response sent", {
      method: req.method,
      originalUrl: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

app.get("/health", (req, res) => {
  res.json({ success: true, message: "Support service healthy." });
});

app.use("/api/support", supportRoutes);
// Record every error before the existing handler answers (format unchanged)
app.use(errorlog.errorHandler({ passThrough: true }));
app.use(errorHandler);

const PORT = process.env.PORT || 5004;

async function startServer() {
  await initializeSupportSchema();

  app.listen(PORT, () => {
    console.log(`[SupportService] Running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("[SupportService] Failed to start:", error);
  process.exit(1);
});
