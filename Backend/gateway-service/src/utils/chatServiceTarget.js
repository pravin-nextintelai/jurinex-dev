// Resolves the upstream for /chat/* and /files/secrets (agentic-chat-service).
//
// Why this exists: both proxies used to default to http://localhost:8080. On
// Cloud Run the gateway itself listens on 8080, so with CHAT_SERVICE_URL unset
// every chat/secrets call looped back into the gateway and hit its 404
// catch-all ("Cannot GET /api/chat/secrets"). Locally the chat service runs on
// 8096, so 8080 was wrong there too.
const CLOUD_RUN_AGENTIC_CHAT_URL =
  "https://agentic-chat-service-120280829617.asia-south1.run.app";
const LOCAL_AGENTIC_CHAT_URL = "http://localhost:8096";

let logged = false;

function resolveChatServiceTarget() {
  const explicit = process.env.CHAT_SERVICE_URL || process.env.AGENTIC_CHAT_SERVICE_URL;
  let target;
  let source;
  if (explicit) {
    target = String(explicit).trim().replace(/\/$/, "");
    source = process.env.CHAT_SERVICE_URL ? "CHAT_SERVICE_URL" : "AGENTIC_CHAT_SERVICE_URL";
  } else if (process.env.K_SERVICE) {
    // K_SERVICE is set by Cloud Run. Never point at localhost there.
    target = CLOUD_RUN_AGENTIC_CHAT_URL;
    source = "default (Cloud Run)";
  } else {
    target = LOCAL_AGENTIC_CHAT_URL;
    source = "default (local)";
  }
  if (!logged) {
    logged = true;
    const note = explicit ? "" : " — set CHAT_SERVICE_URL to override";
    console.log(`[GATEWAY] Chat service target: ${target} (${source})${note}`);
  }
  return target;
}

module.exports = { resolveChatServiceTarget, CLOUD_RUN_AGENTIC_CHAT_URL, LOCAL_AGENTIC_CHAT_URL };
