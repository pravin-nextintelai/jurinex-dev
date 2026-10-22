import { normalizeHexColor } from './brandingColorUtils';

/**
 * Single source of truth for branding shape: every export/preview path merges
 * user data with these defaults so no field is ever undefined mid-pipeline.
 *
 * Storage / API use camelCase keys aligned with `branding_storage` and
 * agentic-document-service `branding_service` (see also alias mapping below).
 */
export const DEFAULT_BRANDING_PROFILE = {
  id: null,
  name: 'Default Branding',
  isDefault: false,

  advocateName: '',
  firmName: '',
  tagline: '',
  barCouncilNo: '',
  officeAddress: '',
  phone: '',
  email: '',

  logo: '',
  logoPosition: 'right',
  logoWidth: 80,
  logoHeight: 80,

  letterheadAlignment: 'center',

  fontFamily: 'Times New Roman',
  fontSize: 15,
  lineHeight: 1.5,

  pageSize: 'a4',
  orientation: 'portrait',

  marginTop: 20,
  marginRight: 20,
  marginBottom: 20,
  marginLeft: 20,

  watermark: false,
  watermarkText: '',
  watermarkImageUrl: '',
  watermarkOpacity: 0.12,
  watermarkRotation: -45,
  watermarkFontSize: 48,
  /** Legacy editor field; merged into watermarkRotation when present */
  watermarkAngle: -45,

  primaryColor: '#20b2aa',

  firmNameFontSize: 16,
  firmNameColor: '#000000',
  taglineFontSize: 9,
  taglineColor: '#000000',
  metaFontSize: 8.5,
  metaColor: '#000000',
  headerColor: '#000000',
  footerColor: '#000000',
  bodyTextColor: '#000000',

  headerEnabled: true,
  headerText: '',
  headerAlignment: 'center',
  headerFontSize: 12,

  footerEnabled: true,
  footerPattern: 'Page {n} of {total}',
  footerPosition: 'bottom-center',
  footerFontSize: 10,
  footerText: '',

  showDivider: true,
};

function coerceNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Accept API / legacy / alternate keys (profileName, logoUrl, accentColor, …).
 */
export function coerceBrandingProfileInput(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const p = { ...raw };
  if (p.profileName != null && p.name == null) p.name = p.profileName;
  if (p.logoUrl != null && (p.logo == null || p.logo === '')) p.logo = p.logoUrl;
  if (p.accentColor != null && p.primaryColor == null) p.primaryColor = p.accentColor;
  if (typeof p.showHeader === 'boolean') p.headerEnabled = p.showHeader;
  if (typeof p.showFooter === 'boolean') p.footerEnabled = p.showFooter;
  if (p.watermarkRotation == null && p.watermarkAngle != null) {
    p.watermarkRotation = p.watermarkAngle;
  }
  if (p.logo == null) p.logo = '';
  return p;
}

/**
 * Full merge: defaults + normalized scalars. Always call before template/export.
 */
export function normalizeBrandingProfile(profile) {
  const input = coerceBrandingProfileInput(profile || {});
  const merged = {
    ...DEFAULT_BRANDING_PROFILE,
    ...input,
  };
  merged.logo = merged.logo == null ? '' : String(merged.logo);
  merged.logoWidth = coerceNumber(merged.logoWidth, DEFAULT_BRANDING_PROFILE.logoWidth);
  merged.logoHeight = coerceNumber(merged.logoHeight, DEFAULT_BRANDING_PROFILE.logoHeight);
  merged.fontSize = coerceNumber(merged.fontSize, DEFAULT_BRANDING_PROFILE.fontSize);
  merged.lineHeight = coerceNumber(merged.lineHeight, DEFAULT_BRANDING_PROFILE.lineHeight);
  merged.headerFontSize = coerceNumber(merged.headerFontSize, DEFAULT_BRANDING_PROFILE.headerFontSize);
  merged.footerFontSize = coerceNumber(merged.footerFontSize, DEFAULT_BRANDING_PROFILE.footerFontSize);
  merged.firmNameFontSize = coerceNumber(merged.firmNameFontSize, DEFAULT_BRANDING_PROFILE.firmNameFontSize);
  merged.taglineFontSize  = coerceNumber(merged.taglineFontSize,  DEFAULT_BRANDING_PROFILE.taglineFontSize);
  merged.metaFontSize     = coerceNumber(merged.metaFontSize,     DEFAULT_BRANDING_PROFILE.metaFontSize);
  merged.watermarkOpacity = coerceNumber(merged.watermarkOpacity, DEFAULT_BRANDING_PROFILE.watermarkOpacity);
  merged.watermarkRotation = coerceNumber(
    merged.watermarkRotation ?? merged.watermarkAngle,
    DEFAULT_BRANDING_PROFILE.watermarkRotation,
  );
  merged.watermarkFontSize = coerceNumber(merged.watermarkFontSize, DEFAULT_BRANDING_PROFILE.watermarkFontSize);
  merged.marginTop = coerceNumber(merged.marginTop, DEFAULT_BRANDING_PROFILE.marginTop);
  merged.marginRight = coerceNumber(merged.marginRight, DEFAULT_BRANDING_PROFILE.marginRight);
  merged.marginBottom = coerceNumber(merged.marginBottom, DEFAULT_BRANDING_PROFILE.marginBottom);
  merged.marginLeft = coerceNumber(merged.marginLeft, DEFAULT_BRANDING_PROFILE.marginLeft);
  merged.pageSize = String(merged.pageSize || 'a4').toLowerCase();
  merged.orientation = merged.orientation === 'landscape' ? 'landscape' : 'portrait';
  const logoPos = String(merged.logoPosition || 'right').toLowerCase();
  merged.logoPosition = ['left', 'center', 'right'].includes(logoPos) ? logoPos : 'right';
  const lhAlign = String(merged.letterheadAlignment || 'center').toLowerCase();
  merged.letterheadAlignment = ['left', 'center', 'right'].includes(lhAlign) ? lhAlign : 'center';
  const fp = String(merged.footerPosition || 'bottom-center').toLowerCase();
  merged.footerPosition = ['bottom-left', 'bottom-center', 'bottom-right'].includes(fp) ? fp : 'bottom-center';
  merged.watermark = Boolean(merged.watermark);
  merged.headerEnabled = Boolean(merged.headerEnabled);
  merged.footerEnabled = Boolean(merged.footerEnabled);
  merged.showDivider = merged.showDivider !== false;
  merged.isDefault = Boolean(merged.isDefault);
  merged.primaryColor = normalizeHexColor(merged.primaryColor, DEFAULT_BRANDING_PROFILE.primaryColor);
  merged.firmNameColor = normalizeHexColor(merged.firmNameColor, DEFAULT_BRANDING_PROFILE.firmNameColor);
  merged.taglineColor = normalizeHexColor(merged.taglineColor, DEFAULT_BRANDING_PROFILE.taglineColor);
  merged.metaColor = normalizeHexColor(merged.metaColor, DEFAULT_BRANDING_PROFILE.metaColor);
  merged.headerColor = normalizeHexColor(merged.headerColor, DEFAULT_BRANDING_PROFILE.headerColor);
  merged.footerColor = normalizeHexColor(merged.footerColor, DEFAULT_BRANDING_PROFILE.footerColor);
  merged.bodyTextColor = normalizeHexColor(merged.bodyTextColor, DEFAULT_BRANDING_PROFILE.bodyTextColor);
  return merged;
}

/** e.g. "09 Jun 2026" — used for {date} / {today} in header & footer text. */
export function formatBrandingDate(date = new Date()) {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Replace {date} and {today} in branding header/footer strings at export time. */
export function resolveBrandingTokens(text, { date = new Date() } = {}) {
  const formatted = formatBrandingDate(date);
  return String(text ?? '')
    .replace(/\{date\}/gi, formatted)
    .replace(/\{today\}/gi, formatted);
}

export function logBrandingExport(meta) {
  const {
    module: mod,
    exportType,
    profile,
    engine = 'playwright',
    success = true,
    durationMs,
  } = meta || {};
  const p = profile ? normalizeBrandingProfile(profile) : null;
  console.info('[BrandingExport]', {
    module: mod,
    exportType,
    profileId: p?.id,
    engine,
    success,
    durationMs,
    logoPosition: p?.logoPosition,
    hasLogo: Boolean(p?.logo),
    hasWatermark: Boolean(
      (p?.watermark && p?.watermarkText) || (p?.watermark && p?.watermarkImageUrl),
    ),
  });
}
