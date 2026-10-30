/**
 * One port for both apps.
 *
 *   /acts, /acts/*  ->  Next.js (bare-acts-web)     NEXT_URL, default http://localhost:3000
 *   everything else ->  the React app:
 *                        - REACT_URL set (dev)  -> proxied to the Vite dev server
 *                        - otherwise (prod)     -> static files from ./dist with SPA fallback
 *
 *   PORT=8080 node gateway.mjs                          # production: dist + Next
 *   REACT_URL=http://localhost:5173 node gateway.mjs    # dev: Vite + Next behind one port
 *
 * No dependencies: plain node:http, with WebSocket upgrades passed through so
 * Vite and Next hot reload keep working.
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const NEXT_URL = new URL(process.env.NEXT_URL || "http://localhost:3000");
const REACT_URL = process.env.REACT_URL ? new URL(process.env.REACT_URL) : null;
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist");

const NEXT_PREFIX = "/acts";
const isNextPath = (p) => p === NEXT_PREFIX || p.startsWith(`${NEXT_PREFIX}/`) || p.startsWith(`${NEXT_PREFIX}?`);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".map": "application/json",
};

/* ---------- reverse proxy ---------- */

function proxy(req, res, target) {
  const headers = { ...req.headers, host: target.host };
  const forwarded = req.headers["x-forwarded-for"];
  const ip = req.socket.remoteAddress || "";
  headers["x-forwarded-for"] = forwarded ? `${forwarded}, ${ip}` : ip;
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-host"] = req.headers.host || "";

  const upstream = http.request(
    { hostname: target.hostname, port: target.port || 80, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    console.error(`[gateway] ${target.origin}${req.url}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Upstream ${target.origin} is not reachable. Is it running?`);
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, target) {
  const conn = net.connect(target.port || 80, target.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(req.headers)) {
      lines.push(`${key}: ${key === "host" ? target.host : value}`);
    }
    conn.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) conn.write(head);
    socket.pipe(conn).pipe(socket);
  });
  conn.on("error", () => socket.destroy());
  socket.on("error", () => conn.destroy());
}

/* ---------- static SPA (production) ---------- */

function sendFile(res, file, status = 200) {
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(status, {
    "content-type": type,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

function serveSpa(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/+$/, "") || "/";
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const candidates = [
    path.join(DIST, safe),
    path.join(DIST, `${safe}.html`),
    path.join(DIST, safe, "index.html"),
  ];
  for (const file of candidates) {
    if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      sendFile(res, file);
      return;
    }
  }
  sendFile(res, path.join(DIST, "index.html"));
}

/* ---------- server ---------- */

if (!REACT_URL && !fs.existsSync(path.join(DIST, "index.html"))) {
  console.error(`[gateway] ${DIST}/index.html not found. Run "npm run build" first, or set REACT_URL for dev.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://x").pathname;
  if (isNextPath(pathname)) return proxy(req, res, NEXT_URL);
  if (REACT_URL) return proxy(req, res, REACT_URL);
  return serveSpa(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url, "http://x").pathname;
  if (isNextPath(pathname)) return proxyUpgrade(req, socket, head, NEXT_URL);
  if (REACT_URL) return proxyUpgrade(req, socket, head, REACT_URL);
  socket.destroy();
});

server.listen(PORT, () => {
  console.log(`[gateway] http://localhost:${PORT}`);
  console.log(`[gateway]   /acts/*  -> ${NEXT_URL.origin}`);
  console.log(`[gateway]   /*       -> ${REACT_URL ? REACT_URL.origin : DIST}`);
});
