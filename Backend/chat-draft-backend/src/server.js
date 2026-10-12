const express = require("express");
const cors = require("cors");
const config = require("./config");
const chatDraftRoutes = require("./routes/chatDraftRoutes");

const app = express();

// Central error capture (docs/error-logging.md). Vendored copy: ../errorlog
const errorlog = require("../errorlog");
errorlog.install(app, { serviceName: "chat-draft-backend", root: require("path").resolve(__dirname, "..") });

app.use(
  cors({
    origin: config.corsOrigins === "*" ? true : config.corsOrigins.split(",").map((v) => v.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "chat-draft-backend" });
});

app.use("/api/chat-draft", chatDraftRoutes);

// No error handler existed: this one answers in the service's {message} shape,
// with a safe message and the request id, never a stack.
app.use(errorlog.errorHandler({
  format: (err, status, requestId) => ({ message: status >= 500 ? "Internal server error" : err.message, request_id: requestId }),
}));

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`chat-draft-backend running on port ${config.port}`);
});
