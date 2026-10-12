'use strict';
/** Per-request context in AsyncLocalStorage, plus unverified JWT peeking for attribution. */
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const als = new AsyncLocalStorage();
// Set while the error logger itself does I/O (recursion guard). Scoped to the
// async context of that I/O, so unrelated requests are never affected.
const internalAls = new AsyncLocalStorage();

function newRequestId() {
  return crypto.randomBytes(16).toString('hex');
}

class RequestContext {
  constructor(fields = {}) {
    this.requestId = fields.requestId || newRequestId();
    this.ipAddress = fields.ipAddress || null;
    this.endpoint = fields.endpoint || null;
    this.httpMethod = fields.httpMethod || null;
    this.userAgent = fields.userAgent || null;
    this.userId = fields.userId || null;
    this.userEmail = fields.userEmail || null;
    this.routeTemplate = null;
    this.resourceType = null;
    this.resourceId = null;
    this.action = null;
    this.methodOverride = null;
    this.startedAt = Date.now();
    this.pending = [];
    this.seen = new WeakSet();
    this.responseStarted = false;
    this.streaming = false;
    this.statusCode = null;
    this.contentType = null;
    this.bodyPeek = [];
    this.bodyPeekLen = 0;
    this.userMessage = null;
    this.flushed = false;
    // Set by the error logger's own routes (client reports) when they answer 4xx.
    this.suppress = false;
    // ids of the error_logs rows written for this request (the audit row links to them)
    this.writtenIds = [];
    this.writtenEvents = []; // the error events, so the audit row can carry the error text
    this.extra = {};
    this.req = fields.req || null;
  }
}

function getContext() {
  return als.getStore() || null;
}

function runWith(ctx, fn) {
  return als.run(ctx, fn);
}

function isInternal() {
  return internalAls.getStore() === true;
}

/** Run fn (sync or async) with the recursion guard set for its async context. */
function withInternal(fn) {
  return internalAls.run(true, fn);
}

function setUser(userId, userEmail) {
  const ctx = getContext();
  if (!ctx) return;
  if (userId !== undefined && userId !== null && String(userId).trim()) ctx.userId = String(userId).slice(0, 64);
  if (typeof userEmail === 'string' && userEmail) ctx.userEmail = userEmail.slice(0, 255);
}

function attach(fields = {}) {
  const ctx = getContext();
  if (!ctx) return;
  if (fields.method) ctx.methodOverride = String(fields.method).slice(0, 255);
  if (fields.action) ctx.action = String(fields.action).slice(0, 30);
  if (fields.resourceType) ctx.resourceType = String(fields.resourceType).slice(0, 50);
  if (fields.resourceId !== undefined && fields.resourceId !== null) ctx.resourceId = String(fields.resourceId).slice(0, 100);
  for (const [k, v] of Object.entries(fields)) {
    if (!['method', 'action', 'resourceType', 'resourceId'].includes(k)) ctx.extra[k] = v;
  }
}

const ID_KEYS = ['id', 'user_id', 'userId', 'uid', 'sub'];
const EMAIL_KEYS = ['email', 'user_email', 'preferred_username', 'userEmail', 'mail'];

/** Decode a JWT payload WITHOUT verifying it (attribution only). */
function peekJwtClaims(authorization) {
  if (!authorization || typeof authorization !== 'string') return {};
  let token = authorization.trim();
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const data = JSON.parse(json);
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

function emailFromObj(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of EMAIL_KEYS) {
    if (typeof obj[k] === 'string' && obj[k].includes('@')) return obj[k].slice(0, 255);
  }
  if (obj.user && typeof obj.user === 'object') {
    for (const k of EMAIL_KEYS) {
      if (typeof obj.user[k] === 'string' && obj.user[k].includes('@')) return obj.user[k].slice(0, 255);
    }
  }
  return null;
}

function userFromHeaders(headers) {
  let userId = null; let email = null;
  const xuid = headers['x-user-id'];
  if (xuid && String(xuid).trim()) userId = String(xuid).trim().slice(0, 64);
  const xemail = headers['x-user-email'];
  if (xemail && String(xemail).includes('@')) email = String(xemail).trim().slice(0, 255);
  const claims = peekJwtClaims(headers.authorization);
  if (userId === null) {
    for (const k of ID_KEYS) {
      if (claims[k] !== undefined && claims[k] !== null && claims[k] !== '') { userId = String(claims[k]).slice(0, 64); break; }
    }
  }
  if (!email) email = emailFromObj(claims);
  return { userId, email };
}

function clientIp(headers, remote) {
  const xff = headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first.slice(0, 45);
  }
  const real = headers['x-real-ip'];
  if (real && String(real).trim()) return String(real).trim().slice(0, 45);
  return remote ? String(remote).replace(/^::ffff:/, '').slice(0, 45) : null;
}

module.exports = {
  RequestContext, als, getContext, runWith, isInternal, withInternal, setUser, attach,
  newRequestId, peekJwtClaims, userFromHeaders, clientIp,
};
