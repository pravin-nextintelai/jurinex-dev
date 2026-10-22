import { DEFAULT_BRANDING_PROFILE } from './brandingProfileDefaults';
import { DOCUMENT_SERVICE_URL, getUserIdForDrafting } from '@/config/apiConfig';

/**
 * Branding profiles: the agentic-document-service DB is the source of truth
 * (`/api/branding/profiles`, keyed by X-User-Id); localStorage is only a fast
 * synchronous cache. The cache is wiped by localStorage.clear() on logout, so
 * profiles that only lived there vanished after every session — persisting to
 * the server and re-hydrating via refreshProfiles() fixes that.
 */

const KEY = 'jurinex_branding_profiles';
const API = `${String(DOCUMENT_SERVICE_URL || '').replace(/\/$/, '')}/api/branding/profiles`;

function authHeaders() {
  const uid = getUserIdForDrafting();
  return uid ? { 'X-User-Id': String(uid) } : null;
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { return []; }
}

function writeCache(profiles) {
  localStorage.setItem(KEY, JSON.stringify(profiles));
}

/** Server assigns its own id/timestamps — never send the local ones on create. */
function toServerPayload(profile) {
  const { id, createdAt, updatedAt, ...rest } = profile;
  return rest;
}

function replaceInCache(oldId, serverProfile) {
  if (!serverProfile?.id) return;
  const profiles = readCache();
  const idx = profiles.findIndex((p) => p.id === oldId);
  if (idx >= 0) profiles[idx] = serverProfile;
  else profiles.push(serverProfile);
  writeCache(profiles);
}

// Ids currently being POSTed — refreshProfiles must not re-migrate them.
const inFlight = new Set();

async function pushToServer(profile) {
  const headers = authHeaders();
  if (!headers) return;
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  const body = JSON.stringify(toServerPayload(profile));
  inFlight.add(profile.id);
  try {
    const res = await fetch(`${API}/${encodeURIComponent(profile.id)}`, {
      method: 'PUT', headers: jsonHeaders, body,
    });
    if (res.ok) { replaceInCache(profile.id, await res.json()); return; }
    if (res.status === 404) {
      const created = await fetch(API, { method: 'POST', headers: jsonHeaders, body });
      if (created.ok) replaceInCache(profile.id, await created.json());
    }
  } catch (err) {
    console.warn('[brandingStorage] server sync failed (kept locally):', err);
  } finally {
    inFlight.delete(profile.id);
  }
}

/**
 * Pull the user's profiles from the server, migrating any local-only ones up
 * (pre-sync profiles, or ones saved while the server was unreachable).
 * Returns the fresh list; on failure returns the local cache untouched.
 */
let refreshPromise = null;
export async function refreshProfiles() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const headers = authHeaders();
    if (!headers) return readCache();
    try {
      const res = await fetch(API, { headers });
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const server = (await res.json())?.profiles || [];
      const known = (p) => server.some(
        (s) => s.id === p.id || (s.name && p.name && s.name === p.name)
      );
      const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
      for (const local of readCache()) {
        if (known(local) || inFlight.has(local.id)) continue;
        try {
          const created = await fetch(API, {
            method: 'POST', headers: jsonHeaders, body: JSON.stringify(toServerPayload(local)),
          });
          if (created.ok) server.push(await created.json());
        } catch { /* stays local until next refresh */ }
      }
      // Keep entries that are mid-POST so they don't flicker out of lists.
      const pending = readCache().filter((p) => inFlight.has(p.id));
      writeCache([...server, ...pending]);
      return readCache();
    } catch (err) {
      console.warn('[brandingStorage] refresh failed, using local cache:', err);
      return readCache();
    }
  })();
  try { return await refreshPromise; }
  finally { refreshPromise = null; }
}

export function getProfiles() {
  return readCache();
}

export function getProfile(id) {
  return getProfiles().find(p => p.id === id) || null;
}

export function getDefaultProfile() {
  return getProfiles().find(p => p.isDefault) || null;
}

export function saveProfile(profile) {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  const now = new Date().toISOString();
  const updated = { ...profile, updatedAt: now };
  if (idx >= 0) {
    profiles[idx] = updated;
  } else {
    profiles.push({ ...updated, createdAt: now });
  }
  if (profile.isDefault) {
    profiles.forEach(p => { if (p.id !== profile.id) p.isDefault = false; });
  }
  writeCache(profiles);
  pushToServer(updated); // async; swaps in the server copy (server id) when done
  return updated;
}

export function deleteProfile(id) {
  writeCache(getProfiles().filter(p => p.id !== id));
  const headers = authHeaders();
  if (headers) {
    fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE', headers })
      .catch((err) => console.warn('[brandingStorage] server delete failed:', err));
  }
}

export function newProfile() {
  return {
    ...DEFAULT_BRANDING_PROFILE,
    id: crypto.randomUUID(),
    name: '',
    isDefault: false,
    createdAt: null,
    updatedAt: null,
    logo: '',
  };
}
