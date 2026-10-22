/**
 * User-controlled notification preferences (Settings → Notifications).
 * Stored per browser in localStorage.
 *
 * `push` governs ALL JuriNex alert surfaces — the response-ready browser
 * notification, branded in-app toast, tab-title flash and chime
 * (responseNotifier checks it on every fire, so every call site is covered).
 * `email` / `marketing` are stored for the corresponding server-side mailers.
 */
const STORAGE_KEY = 'jurinex_notification_prefs';

const DEFAULTS = { push: true, email: true, marketing: false };

export const getNotificationPrefs = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
};

export const setNotificationPref = (key, value) => {
  const next = { ...getNotificationPrefs(), [key]: Boolean(value) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full/blocked — the in-memory toggle still applies this session.
  }
  return next;
};

export const notificationsEnabled = (key = 'push') => Boolean(getNotificationPrefs()[key]);
