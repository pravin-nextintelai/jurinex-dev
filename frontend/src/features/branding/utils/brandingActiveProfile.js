import { DOCUMENT_SERVICE_URL } from '@/config/apiConfig';
import { getDefaultProfile } from './brandingStorage';
import { normalizeBrandingProfile } from './brandingProfileDefaults';

/**
 * Resolve the active branding profile: server default → local default → hard defaults.
 * Pass the same X-User-Id string your API expects (when available).
 */
export async function getActiveBrandingProfile(xUserId) {
  if (xUserId) {
    try {
      const res = await fetch(
        `${DOCUMENT_SERVICE_URL}/api/branding/profiles/default`,
        { headers: { 'X-User-Id': String(xUserId) } },
      );
      if (res.ok) {
        const data = await res.json();
        return normalizeBrandingProfile(data);
      }
    } catch (e) {
      console.warn('[Branding] getActiveBrandingProfile: server default failed', e);
    }
  }
  const local = getDefaultProfile();
  if (local) return normalizeBrandingProfile(local);
  return normalizeBrandingProfile({});
}
