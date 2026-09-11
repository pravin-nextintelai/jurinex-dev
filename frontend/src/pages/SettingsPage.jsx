import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Mail, Phone, MapPin, Calendar, Shield, Bell, Palette, Globe, Download, Trash2, LogOut, ChevronRight, Check, Lock, Eye, EyeOff, CreditCard, Monitor, Smartphone, Tablet, RefreshCw, MoreVertical, Type, Brain } from 'lucide-react';
import { useAuth } from '../context';
import { useTheme, THEME_OPTIONS } from '../context/ThemeContext.jsx';
import api from '../services/api';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ProfileSetupForm from '../components/ProfileSetupForm';
import { MemorySettingsPane } from '../components/CaseMemory';
import { canUsePermission, PERMISSION_KEYS, shouldEnforceRbac } from '../utils/permissions';
import { getNotificationPrefs, setNotificationPref } from '../utils/notificationPrefs';
import { FONT_OPTIONS, getFontPref, applyFontPref, ensureFontFaceLoaded, FONT_SIZE_OPTIONS, getFontSizePref, applyFontSizePref } from '../utils/fontPrefs';

const PasswordInput = React.memo(({ id, placeholder, value, onChange, showPassword, onToggle, autoComplete, disabled }) => {
 const inputRef = useRef(null);

 const handleToggle = (e) => {
 e.preventDefault();
 e.stopPropagation();
 
 const input = inputRef.current;
 if (!input) return;
 
 const cursorPosition = input.selectionStart;
 const wasFocused = document.activeElement === input;
 
 onToggle();
 
 requestAnimationFrame(() => {
 if (input && wasFocused) {
 input.focus();
 if (cursorPosition !== null && cursorPosition !== undefined) {
 input.setSelectionRange(cursorPosition, cursorPosition);
 }
 }
 });
 };

 const handleChange = (e) => {
 const newValue = e.target.value;
 onChange(newValue);
 };

 return (
 <div className="relative">
 <input
 ref={inputRef}
 id={id}
 type={showPassword ? 'text' : 'password'}
 value={value}
 onChange={handleChange}
 className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed text-black"
 placeholder={placeholder}
 autoComplete={autoComplete}
 maxLength={100}
 spellCheck="false"
 autoCapitalize="off"
 autoCorrect="off"
 disabled={disabled}
 />
 <button
 type="button"
 onClick={handleToggle}
 onMouseDown={(e) => e.preventDefault()}
 className="password-toggle-btn absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-150 p-1 rounded focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed"
 aria-label={showPassword ? 'Hide password' : 'Show password'}
 tabIndex={-1}
 disabled={disabled}
 >
 {showPassword ? (
 <EyeOff className="w-4 h-4" />
 ) : (
 <Eye className="w-4 h-4" />
 )}
 </button>
 </div>
 );
}, (prevProps, nextProps) => {
 return (
 prevProps.id === nextProps.id &&
 prevProps.value === nextProps.value &&
 prevProps.showPassword === nextProps.showPassword &&
 prevProps.disabled === nextProps.disabled &&
 prevProps.placeholder === nextProps.placeholder &&
 prevProps.autoComplete === nextProps.autoComplete
 );
});

PasswordInput.displayName = 'PasswordInput';

const SettingSection = React.memo(({ icon: Icon, title, children, className = "" }) => (
 <div className={`bg-white border border-gray-200 rounded-lg p-6 ${className}`}>
 <div className="flex items-center mb-4">
 <Icon className="w-5 h-5 text-gray-600 mr-3" />
 <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
 </div>
 {children}
 </div>
));

SettingSection.displayName = 'SettingSection';

// "Jul 29, 2026, 10:57 AM" — matches the Active-sessions table look.
const formatSessionTime = (value) => {
 if (!value) return '—';
 try {
 return new Intl.DateTimeFormat('en-US', {
 month: 'short', day: 'numeric', year: 'numeric',
 hour: 'numeric', minute: '2-digit',
 }).format(new Date(value));
 } catch {
 return '—';
 }
};

// "Chrome (Windows)" — browser without version, OS family only.
const deviceLabel = (session) => {
 const browser = String(session.browser || 'Unknown browser').replace(/\s+\d+$/, '');
 const os = String(session.os || 'Unknown').split(' ')[0];
 return `${browser} (${os})`;
};

const DeviceTypeIcon = ({ type }) => {
 if (type === 'mobile') return <Smartphone className="w-4 h-4 text-gray-400" />;
 if (type === 'tablet') return <Tablet className="w-4 h-4 text-gray-400" />;
 return <Monitor className="w-4 h-4 text-gray-400" />;
};

// "Active sessions" — device-wise login table (Device | Location | IP | Created |
// Updated), max 3 concurrent devices. Sign out other devices via the row menu.
const LoginDevicesSection = () => {
 const [sessions, setSessions] = useState([]);
 const [maxDevices, setMaxDevices] = useState(3);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);
 const [revokingId, setRevokingId] = useState(null);
 const [openMenuId, setOpenMenuId] = useState(null);
 const [selectedIds, setSelectedIds] = useState([]);
 const [bulkBusy, setBulkBusy] = useState(false);

 const loadSessions = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const data = await api.getSessions();
 setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
 if (data?.max_devices) setMaxDevices(data.max_devices);
 } catch (err) {
 console.error('[Settings] Failed to load login sessions:', err);
 setError('Could not load your login sessions. Please try again.');
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 loadSessions();
 }, [loadSessions]);

 useEffect(() => {
 if (openMenuId == null) return undefined;
 const close = (e) => {
 if (!e.target.closest?.('[data-session-menu]')) setOpenMenuId(null);
 };
 document.addEventListener('mousedown', close);
 return () => document.removeEventListener('mousedown', close);
 }, [openMenuId]);

 const handleRevoke = async (session) => {
 if (revokingId) return;
 setRevokingId(session.id);
 try {
 await api.revokeSession(session.id);
 toast.success('Device signed out');
 setSessions((prev) => prev.filter((s) => s.id !== session.id));
 setSelectedIds((prev) => prev.filter((id) => id !== session.id));
 } catch (err) {
 console.error('[Settings] Failed to sign out device:', err);
 toast.error('Could not sign out that device');
 } finally {
 setRevokingId(null);
 setOpenMenuId(null);
 }
 };

 // Only non-current stored rows are selectable (the virtual current entry has id null).
 const otherSessions = sessions.filter((s) => !s.is_current && s.id != null);
 const allSelected = otherSessions.length > 0 && selectedIds.length === otherSessions.length;

 const toggleSelect = (id) => {
 setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
 };

 const toggleSelectAll = () => {
 setSelectedIds(allSelected ? [] : otherSessions.map((s) => s.id));
 };

 const handleRevokeSelected = async () => {
 if (selectedIds.length === 0 || bulkBusy) return;
 setBulkBusy(true);
 try {
 await api.revokeSessions(selectedIds);
 toast.success(`Signed out ${selectedIds.length} device${selectedIds.length > 1 ? 's' : ''}`);
 setSelectedIds([]);
 await loadSessions();
 } catch (err) {
 console.error('[Settings] Failed to sign out selected devices:', err);
 toast.error('Could not sign out the selected devices');
 } finally {
 setBulkBusy(false);
 }
 };

 const handleRevokeAll = async () => {
 if (bulkBusy) return;
 setBulkBusy(true);
 try {
 await api.revokeAllOtherSessions();
 toast.success('Signed out all other devices');
 setSelectedIds([]);
 await loadSessions();
 } catch (err) {
 console.error('[Settings] Failed to sign out all devices:', err);
 toast.error('Could not sign out all devices');
 } finally {
 setBulkBusy(false);
 }
 };

 return (
 <SettingSection icon={Monitor} title="Active sessions">
 <div className="flex items-start justify-between mb-3 gap-4">
 <p className="text-sm text-gray-500">
 You can be signed in on up to <span className="font-semibold text-gray-700">{maxDevices} devices</span> at
 a time. Signing in on another device automatically signs out the oldest session.
 </p>
 <button
 onClick={loadSessions}
 disabled={loading}
 title="Refresh"
 className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600 rounded-md transition-colors disabled:opacity-50"
 >
 <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
 </button>
 </div>

 {loading ? (
 <div className="flex items-center justify-center py-8">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
 </div>
 ) : error ? (
 <div className="text-sm text-red-500 py-4">{error}</div>
 ) : sessions.length === 0 ? (
 <div className="text-sm text-gray-500 py-4">
 No active sessions found. Sessions appear here after your next login.
 </div>
 ) : (
 <>
 {otherSessions.length > 0 && (
 <div className="flex items-center gap-2 mb-3 flex-wrap">
 <button
 onClick={handleRevokeSelected}
 disabled={selectedIds.length === 0 || bulkBusy}
 className="px-3 py-1.5 text-xs font-medium text-white rounded-md transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
 style={{ backgroundColor: '#21C1B6' }}
 onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 >
 {bulkBusy ? 'Signing out...' : `Sign out selected${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
 </button>
 <button
 onClick={handleRevokeAll}
 disabled={bulkBusy}
 className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
 >
 Sign out all other devices
 </button>
 </div>
 )}
 <div className="overflow-x-auto">
 <table className="w-full text-left">
 <thead>
 <tr className="border-b border-gray-200">
 <th className="py-2 pr-3 w-8">
 {otherSessions.length > 0 && (
 <input
 type="checkbox"
 checked={allSelected}
 onChange={toggleSelectAll}
 className="w-4 h-4 rounded border-gray-300 accent-[#21C1B6] cursor-pointer"
 title="Select all other devices"
 />
 )}
 </th>
 <th className="py-2 pr-4 text-xs font-medium text-gray-500">Device</th>
 <th className="py-2 pr-4 text-xs font-medium text-gray-500">Location</th>
 <th className="py-2 pr-4 text-xs font-medium text-gray-500">IP address</th>
 <th className="py-2 pr-4 text-xs font-medium text-gray-500">Created</th>
 <th className="py-2 pr-4 text-xs font-medium text-gray-500">Updated</th>
 <th className="py-2 w-8" />
 </tr>
 </thead>
 <tbody>
 {sessions.map((session) => (
 <tr key={session.id ?? 'current'} className="border-b border-gray-100 hover:bg-gray-50">
 <td className="py-3 pr-3">
 {!session.is_current && session.id != null && (
 <input
 type="checkbox"
 checked={selectedIds.includes(session.id)}
 onChange={() => toggleSelect(session.id)}
 className="w-4 h-4 rounded border-gray-300 accent-[#21C1B6] cursor-pointer"
 />
 )}
 </td>
 <td className="py-3 pr-4">
 <div className="flex items-center gap-2 whitespace-nowrap">
 <DeviceTypeIcon type={session.device_type} />
 <span className="text-sm text-gray-900">{deviceLabel(session)}</span>
 {session.is_current && (
 <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E8F7F5] text-[#0F766E]">
 Current
 </span>
 )}
 </div>
 </td>
 <td className="py-3 pr-4 text-sm text-gray-600">{session.location || 'Unknown'}</td>
 <td className="py-3 pr-4 text-sm text-gray-600 whitespace-nowrap">{session.ip_address || 'Unknown'}</td>
 <td className="py-3 pr-4 text-sm text-gray-600 whitespace-nowrap">{formatSessionTime(session.login_time)}</td>
 <td className="py-3 pr-4 text-sm text-gray-600 whitespace-nowrap">{formatSessionTime(session.last_active_at)}</td>
 <td className="py-3 relative">
 {!session.is_current && (
 <div className="relative" data-session-menu>
 <button
 onClick={() => setOpenMenuId(openMenuId === session.id ? null : session.id)}
 className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
 title="Session options"
 >
 <MoreVertical className="w-4 h-4" />
 </button>
 {openMenuId === session.id && (
 <div className="absolute right-0 top-7 w-36 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
 <button
 onClick={() => handleRevoke(session)}
 disabled={revokingId !== null}
 className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
 >
 {revokingId === session.id ? 'Signing out...' : 'Sign out'}
 </button>
 </div>
 )}
 </div>
 )}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </>
 )}
 </SettingSection>
 );
};

// Settings → Appearance: theme picker. The real restyling lives in
// index.css keyed on html[data-theme]; swatches carry .jnx-theme-swatch so the
// dark/evergreen root filters never distort the previews.
const THEME_SWATCHES = {
 light: { bg: '#ffffff', border: '#e5e7eb', bar1: '#111827', bar2: '#9ca3af', chip: '#21C1B6' },
 dark: { bg: '#262624', border: '#3a3936', bar1: '#e8e6e0', bar2: '#8a8880', chip: '#21C1B6' },
 sepia: { bg: '#f6efdd', border: '#e3d5b3', bar1: '#4a3f2a', bar2: '#a08c66', chip: '#0f766e' },
 evergreen: { bg: '#eef6f2', border: '#b6d4ce', bar1: '#0F172A', bar2: '#5f7a72', chip: '#0F766E' },
};

const ThemeSection = () => {
 const { theme, setTheme } = useTheme();

 const handleSelect = (option) => {
 if (option.id === theme) return;
 setTheme(option.id);
 toast.success(`${option.label} theme applied`);
 };

 return (
 <SettingSection icon={Palette} title="Theme">
 <p className="text-sm text-gray-500 mb-4">
 Pick how JuriNex looks. The theme applies to the entire site instantly and is remembered on this browser.
 </p>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
 {THEME_OPTIONS.map((option) => {
 const isActive = theme === option.id;
 const sw = THEME_SWATCHES[option.id] || THEME_SWATCHES.light;
 return (
 <button
 key={option.id}
 type="button"
 onClick={() => handleSelect(option)}
 className="text-left rounded-lg border p-3 transition-all duration-150"
 style={{
 borderColor: isActive ? '#21C1B6' : '#e5e7eb',
 backgroundColor: isActive ? '#F7FDFC' : '#ffffff',
 boxShadow: isActive ? '0 0 0 3px rgba(33,193,182,0.15)' : 'none',
 cursor: 'pointer',
 }}
 onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = '#21C1B6'; }}
 onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = '#e5e7eb'; }}
 >
 <div
 className="jnx-theme-swatch rounded-md mb-3 p-3"
 style={{ backgroundColor: sw.bg, border: `1px solid ${sw.border}` }}
 >
 <div className="h-2 rounded-full mb-1.5" style={{ backgroundColor: sw.bar1, width: '60%' }} />
 <div className="h-2 rounded-full mb-1.5" style={{ backgroundColor: sw.bar2, width: '85%' }} />
 <div className="h-2 rounded-full" style={{ backgroundColor: sw.bar2, width: '40%' }} />
 <div className="mt-2 h-4 w-10 rounded" style={{ backgroundColor: sw.chip }} />
 </div>
 <div className="flex items-center justify-between">
 <span className="text-sm font-semibold" style={{ color: isActive ? '#0F766E' : '#111827' }}>
 {option.label}
 </span>
 {isActive && (
 <span className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: '#21C1B6' }}>
 <Check className="w-3 h-3 text-white" />
 </span>
 )}
 </div>
 <div className="text-xs text-gray-400 mt-0.5">{option.note}</div>
 </button>
 );
 })}
 </div>
 </SettingSection>
 );
};

// Settings → Appearance: site-wide font size. Applied via CSS zoom on <body>
// (the app hardcodes px sizes, so rem scaling alone would miss most text).
const FontSizeSection = () => {
 const [sizeId, setSizeId] = useState(() => getFontSizePref());

 const handleSelect = (option) => {
 if (option.id === sizeId) return;
 applyFontSizePref(option.id);
 setSizeId(option.id);
 toast.success(`Font size: ${option.label}`);
 };

 return (
 <SettingSection icon={Type} title="Font size">
 <p className="text-sm text-gray-500 mb-4">
 Makes the reading text bigger or smaller — layout, buttons and menus stay exactly the same.
 Applies instantly and is remembered on this browser.
 </p>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
 {FONT_SIZE_OPTIONS.map((option) => {
 const isActive = sizeId === option.id;
 return (
 <button
 key={option.id}
 type="button"
 onClick={() => handleSelect(option)}
 className="rounded-lg border p-3 text-center transition-all duration-150"
 style={{
 borderColor: isActive ? '#21C1B6' : '#e5e7eb',
 backgroundColor: isActive ? '#F7FDFC' : '#ffffff',
 boxShadow: isActive ? '0 0 0 3px rgba(33,193,182,0.15)' : 'none',
 cursor: 'pointer',
 }}
 onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = '#21C1B6'; }}
 onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = '#e5e7eb'; }}
 >
 <div
 className="text-gray-800 font-semibold leading-none mb-2"
 style={{ fontSize: `${Math.round(18 * option.zoom)}px` }}
 >
 Aa
 </div>
 <div className="flex items-center justify-center gap-1.5">
 <span className="text-xs font-medium" style={{ color: isActive ? '#0F766E' : '#4b5563' }}>
 {option.label}
 </span>
 {isActive && (
 <span className="flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: '#21C1B6' }}>
 <Check className="w-2.5 h-2.5 text-white" />
 </span>
 )}
 </div>
 <div className="text-[11px] text-gray-400 mt-0.5">{Math.round(option.zoom * 100)}%</div>
 </button>
 );
 })}
 </div>
 </SettingSection>
 );
};

// Settings → Appearance: site-wide font picker. Cards preview each font live;
// selecting one applies it to the entire app instantly (see utils/fontPrefs.js).
const FontSection = () => {
 const [fontId, setFontId] = useState(() => getFontPref());

 // Load the Google-hosted fonts once so every card previews in its real face.
 useEffect(() => {
 FONT_OPTIONS.forEach(ensureFontFaceLoaded);
 }, []);

 const handleSelect = (font) => {
 if (font.id === fontId) return;
 applyFontPref(font.id);
 setFontId(font.id);
 toast.success(`Font changed to ${font.label}`);
 };

 const current = FONT_OPTIONS.find((f) => f.id === fontId) || FONT_OPTIONS[0];

 return (
 <SettingSection icon={Type} title="Appearance">
 <p className="text-sm text-gray-500 mb-4">
 Current font: <span className="font-semibold text-gray-700">{current.label}</span>
 {current.note ? ` (${current.note})` : ''}. The selected font applies to the whole site on this browser.
 </p>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 {FONT_OPTIONS.map((font) => {
 const isActive = font.id === fontId;
 return (
 <button
 key={font.id}
 type="button"
 onClick={() => handleSelect(font)}
 className="text-left rounded-lg border p-4 transition-all duration-150"
 style={{
 borderColor: isActive ? '#21C1B6' : '#e5e7eb',
 backgroundColor: isActive ? '#F7FDFC' : '#ffffff',
 boxShadow: isActive ? '0 0 0 3px rgba(33,193,182,0.15)' : 'none',
 cursor: 'pointer',
 }}
 onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.borderColor = '#21C1B6'; }}
 onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.borderColor = '#e5e7eb'; }}
 >
 <div className="flex items-center justify-between mb-1">
 <span
 className="text-sm font-semibold"
 style={{ color: isActive ? '#0F766E' : '#111827' }}
 >
 {font.label}
 </span>
 {isActive && (
 <span
 className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0"
 style={{ backgroundColor: '#21C1B6' }}
 >
 <Check className="w-3 h-3 text-white" />
 </span>
 )}
 </div>
 <div className="text-xs text-gray-400 mb-2">{font.note}</div>
 {/* --jnx-sample-font lets the preview keep ITS font while a site-wide
 override is active (the override exempts .jnx-font-sample via this var) */}
 <div
 className="text-lg text-gray-800 leading-snug jnx-font-sample"
 style={{ fontFamily: font.stack, '--jnx-sample-font': font.stack }}
 >
 AaBbCc 123
 </div>
 <div
 className="text-xs text-gray-500 mt-0.5 jnx-font-sample"
 style={{ fontFamily: font.stack, '--jnx-sample-font': font.stack }}
 >
 The quick brown fox jumps over the lazy dog.
 </div>
 </button>
 );
 })}
 </div>
 </SettingSection>
 );
};

// Settings sub-sidebar (Claude-style): one entry per section; the right pane
// shows only the active section. Sections stay mounted (hidden) so in-progress
// edits and fetched data survive switching tabs.
const SETTINGS_NAV = [
 { id: 'account', label: 'Account', icon: User },
 { id: 'security', label: 'Password & Security', icon: Lock },
 { id: 'sessions', label: 'Active sessions', icon: Monitor },
 { id: 'language', label: 'Language & Region', icon: Globe },
 { id: 'appearance', label: 'Appearance', icon: Type },
 { id: 'notifications', label: 'Notifications', icon: Bell },
 { id: 'privacy', label: 'Privacy & Security', icon: Shield },
 { id: 'memory', label: 'Memory', icon: Brain },
 { id: 'data', label: 'Data & Storage', icon: Download },
 { id: 'actions', label: 'Account Actions', icon: LogOut },
];

const ToggleSwitch = React.memo(({ enabled, onChange, label, description }) => (
 <div className="flex items-center justify-between py-3">
 <div className="flex-1">
 <div className="text-sm font-medium text-gray-900">{label}</div>
 {description && <div className="text-sm text-gray-500">{description}</div>}
 </div>
 <button
 onClick={onChange}
 className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
 enabled ? 'bg-green-600' : 'bg-gray-200'
 }`}
 >
 <span
 className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
 enabled ? 'translate-x-6' : 'translate-x-1'
 }`}
 />
 </button>
 </div>
));

ToggleSwitch.displayName = 'ToggleSwitch';

const SettingsPage = () => {
 const navigate = useNavigate();
 const { user: authUser, loading: authLoading, planInfo, token, fetchAndStorePlan } = useAuth();
 const { theme, setTheme, toggleTheme } = useTheme();
 const [language, setLanguage] = useState('English');
 // Persisted per browser; `push` gates ALL JuriNex alerts (response-ready
 // notification/toast/chime) via responseNotifier → notificationPrefs.
 const [notifications, setNotifications] = useState(() => getNotificationPrefs());
 // Which settings section the sub-sidebar has selected.
 const [activeSection, setActiveSection] = useState('account');
 const paneClass = (id) => (activeSection === id ? 'space-y-6' : 'hidden');

 const [userData, setUserData] = useState({
 fullName: '',
 email: '',
 phone: '',
 location: '',
 joinDate: ''
 });

 const [loading, setLoading] = useState(true);
 const profileFetchedForUserRef = useRef(null);
 const planRefreshAttemptedRef = useRef(false);
 const [error, setError] = useState(null);
 const [isEditingProfile, setIsEditingProfile] = useState(false);
 const [isEditingPassword, setIsEditingPassword] = useState(false);
 const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
 const [showProfileSetup, setShowProfileSetup] = useState(false);

 const [showPasswords, setShowPasswords] = useState({
 current: false,
 new: false,
 confirm: false
 });

 const [passwordValues, setPasswordValues] = useState({
 current: '',
 new: '',
 confirm: ''
 });
 const canViewAccountSettings = canUsePermission(authUser, PERMISSION_KEYS.VIEW_ACCOUNT_SETTINGS);
 const currentPlanName = planInfo?.plan || planInfo?.planName || 'No active plan';

 const handleCurrentPasswordChange = useCallback((value) => {
 setPasswordValues(prev => ({ ...prev, current: value }));
 }, []);

 const handleNewPasswordChange = useCallback((value) => {
 setPasswordValues(prev => ({ ...prev, new: value }));
 }, []);

 const handleConfirmPasswordChange = useCallback((value) => {
 setPasswordValues(prev => ({ ...prev, confirm: value }));
 }, []);

 const fullNameRef = useRef(null);
 const emailRef = useRef(null);
 const phoneRef = useRef(null);
 const locationRef = useRef(null);

 const handleThemeChange = (newTheme) => {
 setTheme(newTheme);
 };

 const handleNotificationChange = (type) => {
 const value = !notifications[type];
 setNotifications((prev) => ({ ...prev, [type]: value }));
 setNotificationPref(type, value);
 if (type === 'push') {
 if (value) {
 if ('Notification' in window && Notification.permission === 'default') {
 Notification.requestPermission().catch(() => {});
 } else if ('Notification' in window && Notification.permission === 'denied') {
 toast.info('Browser notifications are blocked for this site — in-app alerts will still show.');
 }
 toast.success('JuriNex notifications turned on');
 } else {
 toast.info('JuriNex notifications turned off');
 }
 }
 };

 const handleProfileSave = async () => {
 const formData = {
 fullname: fullNameRef.current?.value || '',
 email: emailRef.current?.value || '',
 phone: phoneRef.current?.value || '',
 location: locationRef.current?.value || ''
 };

 try {
 const updatedUser = await api.updateProfile(formData);
 
 setUserData(prev => ({
 ...prev,
 fullName: updatedUser.user.username || formData.fullname,
 email: updatedUser.user.email || formData.email,
 phone: updatedUser.user.phone || formData.phone,
 location: updatedUser.user.location || formData.location
 }));
 
 setIsEditingProfile(false);
 toast.success('Profile updated successfully!');
 } catch (err) {
 console.error('Error updating profile:', err);
 toast.error(err.response?.data?.message || 'Failed to update profile.');
 }
 };

 const handlePasswordSave = async () => {
 const currentPassword = passwordValues.current.trim();
 const newPassword = passwordValues.new.trim();
 const confirmPassword = passwordValues.confirm.trim();

 if (!currentPassword || !newPassword || !confirmPassword) {
 toast.error('Please fill in all password fields.');
 return;
 }

 if (newPassword !== confirmPassword) {
 toast.error('New passwords do not match.');
 return;
 }

 if (newPassword.length < 6) {
 toast.error('New password must be at least 6 characters long.');
 return;
 }

 if (currentPassword === newPassword) {
 toast.error('New password must be different from current password.');
 return;
 }

 const hasUpperCase = /[A-Z]/.test(newPassword);
 const hasLowerCase = /[a-z]/.test(newPassword);
 const hasNumber = /[0-9]/.test(newPassword);
 
 if (!hasUpperCase || !hasLowerCase || !hasNumber) {
 toast.warning('For better security, use a mix of uppercase, lowercase, and numbers.');
 }

 try {
 setIsUpdatingPassword(true);
 
 const response = await api.updatePassword({
 currentPassword: currentPassword,
 newPassword: newPassword,
 confirmPassword: confirmPassword,
 });
 
 setPasswordValues({
 current: '',
 new: '',
 confirm: ''
 });
 
 setIsEditingPassword(false);
 
 toast.success(response.message || 'Password updated successfully!');
 
 } catch (err) {
 console.error('Error updating password:', err);
 
 if (err.response?.status === 401) {
 toast.error('Current password is incorrect. Please try again.');
 } else if (err.response?.status === 400) {
 toast.error(err.response?.data?.message || 'Invalid password format.');
 } else if (err.response?.status === 500) {
 toast.error('Server error. Please try again later.');
 } else {
 toast.error(err.response?.data?.message || 'Failed to update password. Please try again.');
 }
 } finally {
 setIsUpdatingPassword(false);
 }
 };

 const toggleCurrentPasswordVisibility = useCallback(() => {
 setShowPasswords(prev => ({ ...prev, current: !prev.current }));
 }, []);

 const toggleNewPasswordVisibility = useCallback(() => {
 setShowPasswords(prev => ({ ...prev, new: !prev.new }));
 }, []);

 const toggleConfirmPasswordVisibility = useCallback(() => {
 setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }));
 }, []);

 const handleDeleteAccount = async () => {
 try {
 await api.deleteAccount();
 setTimeout(() => {
 handleLogout();
 }, 2000);
 } catch (err) {
 console.error('Error deleting account:', err);
 }
 };

 const handleDeleteAllConversations = async () => {
   try {
     await api.deleteAllConversations();
   } catch (err) {
     console.error('Error deleting all conversations:', err);
   }
 };

 const handleLogout = async () => {
 try {
 await api.logoutUser();
 
 api.logout();
 
 toast.success('Logged out successfully!');
 
 setTimeout(() => {
 window.location.href = '/login';
 }, 1000);
 } catch (err) {
 console.error('Error logging out:', err);
 api.logout();
 toast.success('Logged out successfully!');
 setTimeout(() => {
 window.location.href = '/login';
 }, 1000);
 }
 };

 const handlePhoneInput = (e) => {
 const value = e.target.value.replace(/\D/g, '');
 if (value.length <= 10) {
 e.target.value = value;
 } else {
 e.target.value = value.slice(0, 10);
 }
 };

 useEffect(() => {
 const isBlockedFirmUser = shouldEnforceRbac(authUser) && !canViewAccountSettings;

 if (authLoading || !authUser?.id || isBlockedFirmUser) {
 return;
 }

 if (profileFetchedForUserRef.current === authUser.id) {
 return;
 }
 const isFirstLoad = profileFetchedForUserRef.current === null;
 profileFetchedForUserRef.current = authUser.id;

 const fetchUserProfile = async () => {
 try {
 if (isFirstLoad) {
 setLoading(true);
 }
 const response = await api.fetchProfile();
 const user = response.user;
 
 setUserData({
 fullName: user.username || '',
 email: user.email || '',
 phone: user.phone || '',
 location: user.location || '',
 joinDate: user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', {
 year: 'numeric',
 month: 'long',
 day: 'numeric'
 }) : 'N/A'
 });
 setError(null);
 } catch (err) {
 setError('Failed to fetch user profile.');
 console.error('Error fetching profile:', err);
 toast.error('Failed to load profile data.');
 } finally {
 setLoading(false);
 }
 };

 fetchUserProfile();
 }, [authLoading, authUser?.id, canViewAccountSettings]);

 useEffect(() => {
 if (!token || planInfo?.plan || typeof fetchAndStorePlan !== 'function') {
 return;
 }
 if (planRefreshAttemptedRef.current) {
 return;
 }
 planRefreshAttemptedRef.current = true;

 fetchAndStorePlan(token).catch((err) => {
 console.error('Error refreshing current plan on settings page:', err);
 });
 }, [token, planInfo?.plan, fetchAndStorePlan]);

 useEffect(() => {
 const isBlockedFirmUser = shouldEnforceRbac(authUser) && !canViewAccountSettings;

 if (authLoading) {
 return;
 }

 if (isBlockedFirmUser) {
 navigate('/dashboard', { replace: true });
 }
 }, [authLoading, authUser, canViewAccountSettings, navigate]);

 if (authLoading || (shouldEnforceRbac(authUser) && !canViewAccountSettings)) {
 return null;
 }

 if (loading) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-gray-50">
 <div className="text-center">
 <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
 <p className="mt-4 text-gray-600">Loading settings...</p>
 </div>
 </div>
 );
 }

 if (error) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-gray-50">
 <div className="text-center">
 <p className="text-red-600 text-lg">{error}</p>
 <button
 onClick={() => window.location.reload()}
 className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
 >
 Retry
 </button>
 </div>
 </div>
 );
 }


 return (
 <div className="min-h-screen bg-gray-50">
 <ToastContainer
 position="top-right"
 autoClose={5000}
 hideProgressBar={false}
 newestOnTop
 closeOnClick
 rtl={false}
 pauseOnFocusLoss
 draggable
 pauseOnHover
 theme="light"
 />
 
 <div className="bg-white border-b border-gray-200">
 <div className="max-w-6xl mx-auto px-6 py-6">
 <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
 <p className="text-gray-600 mt-1">Manage your account and application preferences</p>
 </div>
 </div>

 <div className="max-w-6xl mx-auto px-6 py-8">
 <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start">

 {/* Sub-sidebar: horizontal scroll strip on mobile, sticky column on desktop */}
 <nav className="w-full md:w-56 flex-shrink-0">
 <div className="md:sticky md:top-6 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
 {SETTINGS_NAV.map((item) => {
 const ItemIcon = item.icon;
 const isActive = activeSection === item.id;
 return (
 <button
 key={item.id}
 type="button"
 onClick={() => setActiveSection(item.id)}
 className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm whitespace-nowrap text-left transition-colors flex-shrink-0 md:w-full ${
 isActive
 ? 'bg-gray-100 text-gray-900 font-semibold'
 : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
 }`}
 >
 <ItemIcon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[#21C1B6]' : 'text-gray-400'}`} />
 {item.label}
 </button>
 );
 })}
 </div>
 </nav>

 {/* Content pane: only the selected section is visible (others stay mounted) */}
 <div className="flex-1 min-w-0 w-full">

 <div className={paneClass('account')}>
 <SettingSection icon={User} title="Account">
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <div className="flex items-center space-x-4">
 <div
 className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium shadow-lg transition-colors duration-200 transform hover:-translate-y-0.5 hover:shadow-xl"
 style={{ backgroundColor: '#21C1B6' }}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 >
 <User className="w-6 h-6" />
 </div>
 <div>
 <div className="font-medium text-gray-900">{userData.fullName}</div>
 <div className="text-sm text-gray-500">Joined {userData.joinDate}</div>
 <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#E8F7F5] px-3 py-1 text-xs font-semibold text-[#0F766E]">
 <CreditCard className="w-3.5 h-3.5" />
 <span>Current Plan: {currentPlanName}</span>
 </div>
 </div>
 </div>
 <button
 onClick={() => setShowProfileSetup(!showProfileSetup)}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6' }}
 >
 {showProfileSetup ? 'Hide Profile Setup' : 'Complete Profile Setup'}
 </button>
 </div>

 {showProfileSetup && (
 <div className="border-t pt-6 mt-6">
 <ProfileSetupForm
 onSave={() => {
 setShowProfileSetup(false);
 window.dispatchEvent(new CustomEvent('userInfoUpdated'));
 toast.success('Profile updated successfully!');
 }}
 />
 </div>
 )}

 {isEditingProfile ? (
 <div className="space-y-4 border-t pt-4">
 <div>
 <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
 <input
 ref={fullNameRef}
 id="fullName"
 type="text"
 defaultValue={userData.fullName}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 placeholder="Enter your full name"
 />
 </div>
 <div>
 <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
 <input
 ref={emailRef}
 id="email"
 type="email"
 defaultValue={userData.email}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 placeholder="Enter your email"
 />
 </div>
 <div>
 <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone (10 digits only)</label>
 <input
 ref={phoneRef}
 id="phone"
 type="tel"
 defaultValue={userData.phone}
 onInput={handlePhoneInput}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 placeholder="Enter your 10-digit phone number"
 maxLength="10"
 />
 </div>
 <div>
 <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">Location</label>
 <input
 ref={locationRef}
 id="location"
 type="text"
 defaultValue={userData.location}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 placeholder="Enter your location"
 />
 </div>
 <div className="flex space-x-3">
 <button
 onClick={handleProfileSave}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6' }}
 >
 Save Changes
 </button>
 <button
 onClick={() => setIsEditingProfile(false)}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6' }}
 >
 Cancel
 </button>
 </div>
 </div>
 ) : (
 <div className="space-y-3 border-t pt-4">
 <div className="flex items-center text-sm">
 <Mail className="w-4 h-4 text-gray-400 mr-3" />
 <span className="text-gray-600">{userData.email || 'Not provided'}</span>
 </div>
                <div className="flex items-center text-sm">
                  <Phone className="w-4 h-4 text-gray-400 mr-3" />
                  <span className="text-gray-600">{userData.phone || 'Not provided'}</span>
                </div>
                <div className="flex items-center text-sm">
                  <CreditCard className="w-4 h-4 text-gray-400 mr-3" />
                  <span className="text-gray-600">{currentPlanName}</span>
                </div>
 </div>
 )}
 </div>
 </SettingSection>
 </div>

 <div className={paneClass('security')}>
 <SettingSection icon={Lock} title="Password & Security">
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <div>
 <div className="text-sm font-medium text-gray-900">Password</div>
 <div className="text-sm text-gray-500">Update your account password</div>
 </div>
 <button
 onClick={() => {
 setIsEditingPassword(!isEditingPassword);
 if (isEditingPassword) {
 setPasswordValues({ current: '', new: '', confirm: '' });
 }
 }}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6' }}
 disabled={isUpdatingPassword}
 >
 {isEditingPassword ? 'Cancel' : 'Change Password'}
 </button>
 </div>

 {isEditingPassword && (
 <div className="space-y-4 border-t pt-4">
 <div>
 <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
 Current Password <span className="text-red-500">*</span>
 </label>
 <PasswordInput
 id="currentPassword"
 placeholder="Enter current password"
 value={passwordValues.current}
 onChange={handleCurrentPasswordChange}
 showPassword={showPasswords.current}
 onToggle={toggleCurrentPasswordVisibility}
 autoComplete="current-password"
 disabled={isUpdatingPassword}
 />
 </div>
 <div>
 <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
 New Password <span className="text-red-500">*</span>
 </label>
 <PasswordInput
 id="newPassword"
 placeholder="Enter new password (min. 6 characters)"
 value={passwordValues.new}
 onChange={handleNewPasswordChange}
 showPassword={showPasswords.new}
 onToggle={toggleNewPasswordVisibility}
 autoComplete="new-password"
 disabled={isUpdatingPassword}
 />
 <p className="mt-1 text-xs text-gray-500">
 Password should contain uppercase, lowercase, and numbers for better security
 </p>
 </div>
 <div>
 <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
 Confirm New Password <span className="text-red-500">*</span>
 </label>
 <PasswordInput
 id="confirmPassword"
 placeholder="Confirm new password"
 value={passwordValues.confirm}
 onChange={handleConfirmPasswordChange}
 showPassword={showPasswords.confirm}
 onToggle={toggleConfirmPasswordVisibility}
 autoComplete="new-password"
 disabled={isUpdatingPassword}
 />
 </div>
 <div className="flex space-x-3">
 <button
 onClick={handlePasswordSave}
 disabled={isUpdatingPassword}
 onMouseEnter={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
 style={{ backgroundColor: isUpdatingPassword ? '#9CA3AF' : '#21C1B6' }}
 >
 {isUpdatingPassword ? (
 <span className="flex items-center">
 <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
 </svg>
 Updating...
 </span>
 ) : (
 'Update Password'
 )}
 </button>
 <button
 onClick={() => {
 setIsEditingPassword(false);
 setPasswordValues({
 current: '',
 new: '',
 confirm: ''
 });
 }}
 disabled={isUpdatingPassword}
 onMouseEnter={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => !isUpdatingPassword && (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="px-4 py-2 text-white text-sm font-medium rounded-md transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
 style={{ backgroundColor: isUpdatingPassword ? '#9CA3AF' : '#21C1B6' }}
 >
 Cancel
 </button>
 </div>
 </div>
 )}
 </div>
 </SettingSection>
 </div>

 <div className={paneClass('sessions')}>
 <LoginDevicesSection />
 </div>

 <div className={paneClass('language')}>
 <SettingSection icon={Globe} title="Language & Region">
 <div className="space-y-4">
 <div>
 <label htmlFor="language" className="block text-sm font-medium text-gray-700 mb-2">Language</label>
 <select
 id="language"
 value={language}
 onChange={(e) => setLanguage(e.target.value)}
 className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
 >
 <option value="English">English</option>
 <option value="Spanish">Español</option>
 <option value="French">Français</option>
 <option value="German">Deutsch</option>
 <option value="Chinese">中文</option>
 </select>
 </div>
 </div>
 </SettingSection>
 </div>

 <div className={paneClass('appearance')}>
 <ThemeSection />
 <FontSizeSection />
 <FontSection />
 </div>

 <div className={paneClass('notifications')}>
 <SettingSection icon={Bell} title="Notifications">
 <div className="space-y-1">
 <ToggleSwitch
 enabled={notifications.push}
 onChange={() => handleNotificationChange('push')}
 label="JuriNex notifications"
 description="Alerts when response generation completes and other JuriNex updates — browser notification, sound and in-app pop-up"
 />
 <ToggleSwitch
 enabled={notifications.email}
 onChange={() => handleNotificationChange('email')}
 label="Email notifications"
 description="Receive updates about your conversations via email"
 />
 <ToggleSwitch
 enabled={notifications.marketing}
 onChange={() => handleNotificationChange('marketing')}
 label="Marketing emails"
 description="Receive product updates and feature announcements"
 />
 </div>
 </SettingSection>
 </div>

 <div className={paneClass('privacy')}>
 <SettingSection icon={Shield} title="Privacy & Security">
 <div className="space-y-3">
 <div className="flex items-center justify-between py-3 border-b border-gray-100">
 <div>
 <div className="text-sm font-medium text-gray-900">Two-factor authentication</div>
 <div className="text-sm text-gray-500">Add an extra layer of security</div>
 </div>
 <ChevronRight className="w-4 h-4 text-gray-400" />
 </div>
 <div className="flex items-center justify-between py-3 border-b border-gray-100">
 <div>
 <div className="text-sm font-medium text-gray-900">Login activity</div>
 <div className="text-sm text-gray-500">See your recent login history</div>
 </div>
 <ChevronRight className="w-4 h-4 text-gray-400" />
 </div>
 <div className="flex items-center justify-between py-3">
 <div>
 <div className="text-sm font-medium text-gray-900">Connected apps</div>
 <div className="text-sm text-gray-500">Manage third-party integrations</div>
 </div>
 <ChevronRight className="w-4 h-4 text-gray-400" />
 </div>
 </div>
 </SettingSection>
 </div>

 <div className={paneClass('memory')}>
 <SettingSection icon={Brain} title="Memory">
 <MemorySettingsPane
 accountType={authUser?.account_type}
 onOpenProfile={() => {
 setActiveSection('account');
 setShowProfileSetup(true);
 }}
 />
 </SettingSection>
 </div>

 <div className={paneClass('data')}>
 <SettingSection icon={Download} title="Data & Storage">
 <div className="space-y-3">
 <button
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="flex items-center justify-between w-full py-3 px-4 text-left text-white transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 rounded-md"
 style={{ backgroundColor: '#21C1B6' }}
 >
 <div>
 <div className="text-sm font-medium">Export data</div>
 <div className="text-sm text-gray-100">Download your conversation history</div>
 </div>
 <Download className="w-4 h-4" />
 </button>
 <div className="border-t pt-3">
 <button
 onClick={handleDeleteAllConversations}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EF4444')}
 className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#EF4444', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
 >
 <Trash2 className="w-4 h-4 mr-2" />
 <span className="text-sm font-medium">Delete all conversations</span>
 </button>
 </div>
 </div>
 </SettingSection>
 </div>

 <div className={paneClass('actions')}>
 <SettingSection icon={LogOut} title="Account Actions" className="border-red-200">
 <div className="space-y-3">
 <button
 onClick={handleLogout}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#21C1B6', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
 >
 <LogOut className="w-4 h-4 mr-2" />
 <span className="text-sm font-medium">Logout</span>
 </button>
 <div className="border-t pt-3">
 <button
 onClick={handleDeleteAccount}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#DC2626')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EF4444')}
 className="flex items-center text-white hover:text-gray-100 transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
 style={{ backgroundColor: '#EF4444', padding: '0.5rem 1rem', borderRadius: '0.375rem' }}
 >
 <Trash2 className="w-4 h-4 mr-2" />
 <span className="text-sm font-medium">Delete account</span>
 </button>
 <p className="text-xs text-gray-500 mt-1">This action cannot be undone</p>
 </div>
 </div>
 </SettingSection>
 </div>

 </div>
 </div>
 </div>
 </div>
 );
};

export default SettingsPage;
