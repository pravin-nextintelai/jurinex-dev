const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const dotenv = require("dotenv");

dotenv.config();
const authRoutes = require("./src/routes/authRoutes");
const internalRoutes = require("./src/routes/internalRoutes");
const contactEnquiryRoutes = require("./src/routes/contactEnquiryRoutes");
const newsletterRoutes = require("./src/routes/newsletterRoutes");
const pool = require("./src/config/db.js");

const app = express();
// Behind the gateway / Cloud Run, the client IP arrives via X-Forwarded-For —
// trust it so req.ip resolves to the real device address for session tracking.
app.set('trust proxy', true);
const PORT = process.env.PORT || 5001;

const allowedOrigins = (
  process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean)
    : [
        "https://jurinex.netlify.app",
        "https://jurinex-dev.netlify.app",
        "http://localhost:5173","https://ailearn.co.in",
        "https://www.ailearn.co.in"
      ]
);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Local dev: any localhost / 127.0.0.1 port (Vite may use 5174, etc.)
    if (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

app.options('*', cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

app.get("/health", (req, res) => {
  res.json({ status: "Auth Service is running" });
});

const rbacRoutes = require("./src/Rbac_service/rbacRoutes");
const { initializeRbacSchema } = require("./src/Rbac_service/rbacDb");
const { initializeUserActivitySchema } = require("./src/utils/userActivityDb");
const { ensureFirmActiveColumn } = require("./src/utils/ensureFirmActiveColumn");
const { initializeDeviceSessionSchema } = require("./src/utils/deviceSessionDb");
const { initializeContactEnquirySchema } = require("./src/utils/contactEnquiryDb");
const { initializeNewsletterSubscriberSchema } = require("./src/utils/newsletterSubscriberDb");

app.use("/api/auth/contact-enquiries", contactEnquiryRoutes); // Public: landing page "Contact us" form
app.use("/api/auth/newsletter-subscribers", newsletterRoutes); // Public: landing page newsletter form
app.use("/api/auth", authRoutes);
app.use("/api/auth/internal", internalRoutes); // Internal service-to-service routes
app.use("/api/rbac", rbacRoutes);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.error("Bad JSON:", err.message);
    return res.status(400).send({ message: "Invalid JSON payload" });
  }
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

app.listen(PORT, async () => {
  console.log(`Auth Service running on port ${PORT}`);
  await ensureFirmActiveColumn();
  await initializeUserActivitySchema();
  await initializeRbacSchema();
  await initializeDeviceSessionSchema();
  await initializeContactEnquirySchema();
  await initializeNewsletterSubscriberSchema();
});
