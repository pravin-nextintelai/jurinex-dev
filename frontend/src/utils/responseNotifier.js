/**
 * responseNotifier — lets the user know an AI response finished generating,
 * the way Claude.ai does, with JuriNex branding throughout:
 *
 *   While AWAY (another tab, minimized or unfocused window):
 *     1. OS/browser notification with the JuriNex logo (click refocuses the tab)
 *     2. Flashing tab title ("✅ Response ready") until they return
 *     3. A soft two-note chime
 *     4. A branded in-app toast greets them when they come back
 *
 *   While ON the tab:
 *     A branded in-app toast card (logo + green check + teal accent,
 *     slide-in animation, auto-dismiss progress bar).
 *
 * Usage:
 *   ensureNotificationPermission()  — call when the user starts a generation
 *                                     (permission prompt appears while they
 *                                     are still on the tab)
 *   notifyResponseComplete({ title, body }) — call wherever the stream
 *                                     completes; safe to call from multiple
 *                                     completion paths (bursts are collapsed)
 */

import jurinexLogo from '../assets/jurinex-mark.png';
import { notificationsEnabled } from './notificationPrefs';

const BRAND_TEAL = '#0aa396';
const TOAST_ID = 'jurinex-response-toast';
const TOAST_STYLE_ID = 'jurinex-response-toast-styles';
const TOAST_DURATION_MS = 6000;

let baseTitle = null;
let titleTimer = null;
let lastNotifiedAt = 0;
let pendingToast = null;

/* ------------------------------------------------------------------ */
/* Tab title alert                                                     */
/* ------------------------------------------------------------------ */

const restoreTitle = () => {
  if (titleTimer) {
    clearInterval(titleTimer);
    titleTimer = null;
  }
  if (baseTitle !== null) {
    document.title = baseTitle;
    baseTitle = null;
  }
};

const onUserReturned = () => {
  restoreTitle();
  if (pendingToast) {
    const payload = pendingToast;
    pendingToast = null;
    showResponseToast(payload);
  }
};

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) onUserReturned();
  });
  window.addEventListener('focus', onUserReturned);
}

/* ------------------------------------------------------------------ */
/* Notification permission                                             */
/* ------------------------------------------------------------------ */

export const ensureNotificationPermission = () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  // User turned JuriNex notifications off in Settings — don't even prompt.
  if (!notificationsEnabled('push')) return;
  if (Notification.permission !== 'default') return;
  try {
    const result = Notification.requestPermission(() => {});
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // Notifications unsupported — toast, title flash and chime still work.
  }
};

/* ------------------------------------------------------------------ */
/* Soft chime                                                          */
/* ------------------------------------------------------------------ */

const playChime = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = () => {
      const now = ctx.currentTime;
      // Gentle ascending two-note chime (A5 → D6).
      [880, 1174.66].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + i * 0.12;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.6);
      });
      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 1500);
    };
    if (ctx.state === 'suspended') {
      // Autoplay policy: resume only succeeds if the user has interacted
      // with the page this session (they did — they sent the message).
      ctx.resume().then(play).catch(() => ctx.close().catch(() => {}));
    } else {
      play();
    }
  } catch {
    // Audio blocked — notification, toast and title flash still fire.
  }
};

/* ------------------------------------------------------------------ */
/* Branded in-app toast                                                */
/* ------------------------------------------------------------------ */

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const ensureToastStyles = () => {
  if (document.getElementById(TOAST_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TOAST_STYLE_ID;
  style.textContent = `
.jnx-toast {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 2147483000;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 344px;
  max-width: calc(100vw - 40px);
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-left: 4px solid ${BRAND_TEAL};
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08);
  padding: 14px 14px 16px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow: hidden;
  animation: jnx-toast-in 0.3s cubic-bezier(0.21, 1.02, 0.73, 1) both;
}
.jnx-toast--out {
  animation: jnx-toast-out 0.24s ease-in both;
}
@keyframes jnx-toast-in {
  from { opacity: 0; transform: translateX(28px); }
  to   { opacity: 1; transform: none; }
}
@keyframes jnx-toast-out {
  to { opacity: 0; transform: translateX(28px); }
}
.jnx-toast__logo {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  flex: none;
  display: block;
}
.jnx-toast__content {
  flex: 1;
  min-width: 0;
  padding-top: 1px;
}
.jnx-toast__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  line-height: 1.3;
}
.jnx-toast__check {
  width: 16px;
  height: 16px;
  flex: none;
  color: ${BRAND_TEAL};
}
.jnx-toast__body {
  margin-top: 3px;
  font-size: 13px;
  line-height: 1.45;
  color: #6b7280;
}
.jnx-toast__close {
  flex: none;
  margin: -4px -4px 0 0;
  padding: 4px;
  border: none;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 6px;
  line-height: 0;
}
.jnx-toast__close:hover {
  color: #4b5563;
  background: #f3f4f6;
}
.jnx-toast__progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: linear-gradient(90deg, ${BRAND_TEAL}, #10b981);
  animation: jnx-toast-progress ${TOAST_DURATION_MS}ms linear forwards;
}
@keyframes jnx-toast-progress {
  from { width: 100%; }
  to   { width: 0; }
}
@media (max-width: 480px) {
  .jnx-toast { top: 12px; right: 12px; left: 12px; width: auto; }
}
`;
  document.head.appendChild(style);
};

export const showResponseToast = ({
  title = 'Response ready',
  body = 'JuriNex has finished generating your response.',
} = {}) => {
  if (typeof document === 'undefined' || !document.body) return;
  ensureToastStyles();

  const existing = document.getElementById(TOAST_ID);
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.className = 'jnx-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <img class="jnx-toast__logo" src="${jurinexLogo}" alt="JuriNex" />
    <div class="jnx-toast__content">
      <div class="jnx-toast__title">
        <svg class="jnx-toast__check" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/>
        </svg>
        <span>${escapeHtml(title)}</span>
      </div>
      <div class="jnx-toast__body">${escapeHtml(body)}</div>
    </div>
    <button class="jnx-toast__close" type="button" aria-label="Dismiss">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
      </svg>
    </button>
    <div class="jnx-toast__progress"></div>
  `;
  document.body.appendChild(toast);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.add('jnx-toast--out');
    setTimeout(() => toast.remove(), 260);
  };
  toast.querySelector('.jnx-toast__close').addEventListener('click', dismiss);
  setTimeout(dismiss, TOAST_DURATION_MS);
};

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

export const notifyResponseComplete = ({
  title = 'Response ready',
  body = 'JuriNex has finished generating your response.',
} = {}) => {
  if (typeof document === 'undefined') return;

  // Settings → Notifications toggle: off = no toast, no browser notification,
  // no title flash, no chime — across every completion path in the app.
  if (!notificationsEnabled('push')) return;

  // Streams often signal completion on more than one code path — collapse
  // bursts into a single alert.
  const now = Date.now();
  if (now - lastNotifiedAt < 2000) return;
  lastNotifiedAt = now;

  const away = document.hidden || !document.hasFocus();

  if (!away) {
    // User is watching — a branded in-app confirmation is enough.
    showResponseToast({ title, body });
    return;
  }

  // Greet them with the branded toast when they come back.
  pendingToast = { title, body };

  if (document.hidden) {
    if (baseTitle === null) baseTitle = document.title;
    const alertTitle = `✅ ${title}`;
    document.title = alertTitle;
    if (titleTimer) clearInterval(titleTimer);
    titleTimer = setInterval(() => {
      document.title = document.title === alertTitle ? baseTitle : alertTitle;
    }, 1500);
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, {
        body,
        icon: jurinexLogo,
        badge: jurinexLogo,
        tag: 'jurinex-response-complete',
      });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          // Some browsers refuse programmatic focus — notification click
          // still raises the window itself.
        }
        n.close();
      };
      setTimeout(() => n.close(), 15000);
    } catch {
      // Notification constructor can throw on some mobile browsers.
    }
  }

  playChime();
};
