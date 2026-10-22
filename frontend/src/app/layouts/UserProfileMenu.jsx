import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/shared/context';
import { USER_RESOURCES_SERVICE_URL } from '@/config/apiConfig';
import { canUsePermission, PERMISSION_KEYS } from '@/shared/utils/permissions';
import { getPlanDisplayName } from '@/shared/utils/planUtils';
import {
  clearScopedPlanInfo,
  getStoredUserId,
  readScopedPlanInfo,
  writeScopedPlanInfo,
} from '@/shared/utils/planStorage';

const INVALID_PLAN_LABELS = new Set([
  'development',
  'developer',
  'personal',
  'user',
  'users',
]);

const sanitizePlanName = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return INVALID_PLAN_LABELS.has(trimmed.toLowerCase()) ? null : trimmed;
};

/** Prefer paid plan from API/subscription; never show placeholder "Free plan" when DB has a plan. */
const resolveDisplayPlan = (planInfo, userInfo) => {
  const subscription = planInfo?.subscription;
  const planId = planInfo?.planId ?? subscription?.plan_id ?? subscription?.id ?? null;
  const hasPaidPlan = planId != null && Number(planId) > 0;

  const candidates = [
    planInfo?.plan,
    planInfo?.planName,
    subscription?.plan_name,
    subscription?.planName,
    subscription?.name,
  ];

  for (const raw of candidates) {
    const label = sanitizePlanName(raw);
    if (label) return label;
    if (hasPaidPlan && typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }

  if (hasPaidPlan) {
    return `Plan #${planId}`;
  }

  return null;
};

const deriveAccountLabel = (planInfo, userInfo) => {
  const rawType = (
    planInfo?.subscription?.type ||
    planInfo?.subscription?.accountType ||
    planInfo?.subscription?.subscription_type ||
    userInfo?.accountType ||
    userInfo?.subscriptionType ||
    userInfo?.role ||
    ''
  );

  const normalizedType = String(rawType || '').toLowerCase().trim();

  if (['business', 'team', 'enterprise', 'firm', 'law-firm', 'law firm'].includes(normalizedType)) {
    return 'Firm Account';
  }

  if (['individual', 'solo', 'solo-lawyer', 'solo lawyer'].includes(normalizedType)) {
    return 'Individual Account';
  }

  return 'Professional Account';
};

const UserProfileMenu = ({ userData, navigate, onLogout, onClose }) => {
  const [userPlan, setUserPlan] = useState('');
  const [accountLabel, setAccountLabel] = useState('Professional Account');
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userInitials, setUserInitials] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { logout: authLogout, planInfo: contextPlanInfo, user: contextUser, refreshPlan } = useAuth();
  const contextPlanInfoRef = useRef(contextPlanInfo);
  contextPlanInfoRef.current = contextPlanInfo;
  const planBootstrappedRef = useRef(false);
  const permissionUser = contextUser || userData;
  const canViewSettings = canUsePermission(permissionUser, PERMISSION_KEYS.VIEW_ACCOUNT_SETTINGS);
  const fetchPlanFromAPI = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.log('⚠️ No token found, skipping plan fetch');
        return null;
      }

      console.log('🔄 Fetching plan from API...');
      const response = await fetch(`${USER_RESOURCES_SERVICE_URL}/plan-details`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        console.error('❌ Failed to fetch plan from API:', response.status);
        return null;
      }

      const data = await response.json();
      console.log('✅ Fetched plan data from API:', data);

      const activePlan = data.activePlan || data.userSubscription || data.subscription;
      const planId = activePlan?.plan_id ?? activePlan?.id ?? null;
      const hasPaidPlan = planId != null && Number(planId) > 0;

      if (!activePlan || !hasPaidPlan) {
        clearScopedPlanInfo();
        setUserPlan('');
        return null;
      }

      if (activePlan.plan_name || activePlan.planName || activePlan.name || hasPaidPlan) {
        const planName = sanitizePlanName(
          getPlanDisplayName(activePlan) ||
            activePlan.plan_name ||
            activePlan.planName ||
            activePlan.name ||
            'Active plan'
        );
        if (!planName) {
          clearScopedPlanInfo();
          setUserPlan('');
          return null;
        }
        console.log('✅ Plan name from API:', planName);

        const userId = getStoredUserId();
        if (userId != null) {
          writeScopedPlanInfo(userId, { plan: planName, planId });
        }
        setUserPlan(planName);
        return planName;
      }

      clearScopedPlanInfo();
      setUserPlan('');
      return null;
    } catch (error) {
      console.error('❌ Error fetching plan from API:', error);
      return null;
    }
  }, []);

  const getFromStorage = useCallback((key) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      }
    } catch (error) {
      console.error(`Error reading ${key} from localStorage:`, error);
    }
    return null;
  }, []);

  const setToStorage = useCallback((key, value) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.error(`Error setting ${key} to localStorage:`, error);
    }
  }, []);

  const removeFromStorage = useCallback((key) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.error(`Error removing ${key} from localStorage:`, error);
    }
  }, []);

  const clearAllUserData = useCallback(() => {
    try {
      console.log('Starting comprehensive localStorage cleanup...');
      
      const allKeys = Object.keys(localStorage);
      console.log('All localStorage keys before cleanup:', allKeys);

      const specificKeysToRemove = [
        'token',
        'accessToken',
        'refreshToken',
        'authToken',
        'jwt',
        'user',
        'userInfo',
        'userData',
        'currentUser',
        'authUser',
        'auth',
        'profile',
        'session',
        'sessionId',
        'plan',
        'subscription',
        'userPlan',
        'planInfo',
        'userSubscription',
        'animatedResponseContent',
        'currentResponse',
        'documentData',
        'fileId',
        'hasResponse',
        'messages',
        'processingStatus',
        'theme',
      ];

      specificKeysToRemove.forEach((key) => {
        if (localStorage.getItem(key)) {
          removeFromStorage(key);
          console.log(`✅ Removed ${key} from localStorage`);
        }
      });

      const userRelatedPatterns = [
        'user',
        'auth',
        'token',
        'session',
        'profile',
        'plan',
        'subscription',
        'document',
        'file',
        'message',
        'response',
        'processing',
      ];

      allKeys.forEach((key) => {
        const keyLower = key.toLowerCase();
        const shouldRemove = userRelatedPatterns.some(pattern => 
          keyLower.includes(pattern)
        );
        
        if (shouldRemove && !specificKeysToRemove.includes(key)) {
          removeFromStorage(key);
          console.log(`🔍 Pattern-based removal: ${key}`);
        }
      });

      const remainingKeys = Object.keys(localStorage);
      console.log('Remaining localStorage keys after cleanup:', remainingKeys);
      
      window.dispatchEvent(new StorageEvent('storage', {
        key: null,
        oldValue: null,
        newValue: null,
        url: window.location.href
      }));

      console.log('✅ Comprehensive localStorage cleanup completed');
      
    } catch (error) {
      console.error('❌ Error during comprehensive localStorage cleanup:', error);
      
      try {
        console.log('🚨 Attempting complete localStorage clear as fallback...');
        localStorage.clear();
        console.log('✅ Complete localStorage clear successful');
      } catch (clearError) {
        console.error('❌ Even localStorage.clear() failed:', clearError);
      }
    }
  }, [removeFromStorage]);

  const generateInitials = useCallback((name, email) => {
    if (name && name.trim()) {
      const nameParts = name.trim().split(' ').filter(Boolean);
      if (nameParts.length >= 2) {
        return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase();
      } else if (nameParts.length === 1) {
        return nameParts[0].charAt(0).toUpperCase();
      }
    }
    if (email) {
      const emailPart = email.split('@')[0];
      if (emailPart.includes('.')) {
        const parts = emailPart.split('.');
        return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
      } else if (emailPart.includes('_')) {
        const parts = emailPart.split('_');
        return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
      }
      return emailPart.charAt(0).toUpperCase();
    }
    return 'U';
  }, []);

  const getDisplayNameFromEmail = useCallback((email) => {
    if (!email) return '';
    const emailPart = email.split('@')[0];
    return emailPart
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase())
      .trim();
  }, []);

  const syncUserProfile = useCallback(() => {
    const userInfo = userData || contextUser || getFromStorage('user');
    if (!userInfo?.email && !userInfo?.username && !userInfo?.id) {
      return false;
    }

    const email = userInfo.email || '';
    const name =
      userInfo.displayName ||
      userInfo.username ||
      userInfo.name ||
      getDisplayNameFromEmail(email) ||
      (email ? email.split('@')[0] : '');

    setUserEmail(email);
    setUserName(name || 'User');
    setUserInitials(generateInitials(name, email));

    const storedPlanInfo = readScopedPlanInfo(userInfo?.id || contextUser?.id || getStoredUserId());
    setAccountLabel(deriveAccountLabel(contextPlanInfoRef.current || storedPlanInfo, userInfo));
    return true;
  }, [userData, contextUser, getFromStorage, generateInitials, getDisplayNameFromEmail]);

  const updateUserInfo = useCallback(async () => {
    console.log('🔍 UserProfileMenu: Starting updateUserInfo (optimized)...');
    
    let userInfo = null;
    let planInfo = null;

    userInfo = userData || contextUser || getFromStorage('user');
    if (userInfo) {
      console.log('✅ Found user data in prop/context/localStorage:', userInfo);
    } else {
      const userKeys = ['userData', 'currentUser', 'authUser', 'auth', 'profile'];
      for (const key of userKeys) {
        const data = getFromStorage(key);
        if (data && data.id && data.email) {
          userInfo = data;
          console.log(`✅ Found user data in localStorage["${key}"]`, userInfo);
          break;
        }
      }
    }

    const uid = userInfo?.id || contextUser?.id || getStoredUserId();
    if (
      contextPlanInfo?.subscription &&
      contextPlanInfo?.planId > 0 &&
      (contextPlanInfo.plan || contextPlanInfo.planName)
    ) {
      planInfo = contextPlanInfo;
      console.log('⚡ INSTANT: Found plan in RAM (AuthContext):', planInfo.plan || planInfo.planName);
    } else {
      const scoped = readScopedPlanInfo(uid);
      if (scoped?.plan && scoped?.planId > 0) {
        planInfo = { ...scoped, subscription: contextPlanInfo?.subscription || null };
        console.log('✅ Found scoped plan cache:', scoped.plan);
      } else {
        planInfo = null;
        console.log('🌐 No verified plan, fetching from API in background...');
        fetchPlanFromAPI().then((apiPlan) => {
          if (apiPlan) {
            setUserPlan(apiPlan);
          } else {
            setUserPlan('');
          }
        }).catch((err) => {
          console.error('❌ Background API fetch failed:', err);
          setUserPlan('');
        });
      }
    }

    if (userInfo) {
      syncUserProfile();

      const resolved = resolveDisplayPlan(planInfo, userInfo);
      const plan = resolved || '';
      if (resolved) {
        console.log('✅ Plan label resolved:', plan);
      } else {
        console.log('❌ No plan data found, using default:', plan);
      }

      setUserPlan(plan);

      console.log('🎉 Final user info update:', {
        id: userInfo.id,
        email: userInfo.email,
        username: userInfo.username,
        displayName: userInfo.displayName,
        plan,
        lastPayment: planInfo?.lastPayment,
      });
    } else {
      console.log('❌ No user data found in prop or localStorage');
      setUserEmail('');
      setUserName('');
      setUserPlan('');
      setAccountLabel('Professional Account');
      setUserInitials('');
    }
    
  }, [getFromStorage, userData, fetchPlanFromAPI, contextPlanInfo, contextUser, syncUserProfile]);

  const updateUserInfoRef = useRef(updateUserInfo);
  updateUserInfoRef.current = updateUserInfo;

  useEffect(() => {
    const loadPlan = async () => {
      const scoped = readScopedPlanInfo(getStoredUserId());
      const hasPlan =
        (contextPlanInfoRef.current?.planId > 0 && contextPlanInfoRef.current?.subscription) ||
        (scoped?.planId > 0 && scoped?.plan);

      if (!planBootstrappedRef.current && !hasPlan) {
        planBootstrappedRef.current = true;
        if (typeof refreshPlan === 'function') {
          await refreshPlan().catch((err) => console.error('Profile plan refresh failed:', err));
        } else {
          await fetchPlanFromAPI();
        }
      }

      updateUserInfoRef.current();
    };
    loadPlan();

    let customUpdateTimer = null;
    const handleStorageChange = (e) => {
      const userDataKeys = ['user', 'userInfo', 'userData', 'currentUser', 'authUser', 'auth', 'profile', 'plan', 'subscription', 'userPlan', 'planInfo'];
      if (userDataKeys.includes(e.key)) {
        updateUserInfoRef.current();
      }
    };

    const handleCustomUpdate = () => {
      if (customUpdateTimer) window.clearTimeout(customUpdateTimer);
      customUpdateTimer = window.setTimeout(() => {
        updateUserInfoRef.current();
      }, 200);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('userInfoUpdated', handleCustomUpdate);
    window.addEventListener('userDataChanged', handleCustomUpdate);

    return () => {
      if (customUpdateTimer) window.clearTimeout(customUpdateTimer);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('userInfoUpdated', handleCustomUpdate);
      window.removeEventListener('userDataChanged', handleCustomUpdate);
    };
  }, [refreshPlan, fetchPlanFromAPI, getFromStorage]);

  useEffect(() => {
    syncUserProfile();
    const nextPlan = resolveDisplayPlan(contextPlanInfo, contextUser || userData);
    if (nextPlan) {
      setUserPlan((prev) => (prev === nextPlan ? prev : nextPlan));
    }
  }, [contextPlanInfo, contextUser, userData, syncUserProfile]);

  const handleLogout = useCallback(() => {
    onClose?.();
    try {
      console.log('🚀 UserProfileMenu: Starting enhanced logout process...');

      setUserPlan('Free plan');
      setAccountLabel('Professional Account');
      setUserEmail('');
      setUserName('');
      setUserInitials('U');
      setIsLoading(false);

      clearAllUserData();

      window.dispatchEvent(new CustomEvent('userLoggedOut'));
      window.dispatchEvent(new CustomEvent('userDataCleared'));

      if (onLogout) {
        console.log('📤 UserProfileMenu: Using onLogout prop from parent');
        try {
          onLogout();
        } catch (onLogoutError) {
          console.error('❌ Error in onLogout prop:', onLogoutError);
        }
      }

      if (authLogout) {
        console.log('🔐 UserProfileMenu: Using AuthContext logout');
        try {
          authLogout();
        } catch (authLogoutError) {
          console.error('❌ Error in AuthContext logout:', authLogoutError);
        }
      }

      console.log('🔄 UserProfileMenu: Navigating to login page');
      navigate('/login', { replace: true });

      console.log('✅ UserProfileMenu: Enhanced logout process completed successfully');
    } catch (error) {
      console.error('❌ UserProfileMenu: Error during logout:', error);
      
      try {
        console.log('🚨 UserProfileMenu: Attempting emergency cleanup...');
        localStorage.clear();
        console.log('✅ UserProfileMenu: Emergency localStorage clear successful');
      } catch (clearError) {
        console.error('❌ UserProfileMenu: Even emergency clear failed:', clearError);
      }
      
      navigate('/login', { replace: true });
    }
  }, [onLogout, authLogout, navigate, clearAllUserData]);

  if (isLoading && !userName && !userEmail) {
    return (
      <div className="p-3 bg-white">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 mb-2">
          <div className="w-9 h-9 rounded-full bg-gray-200 animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-gray-200 rounded animate-pulse w-24" />
            <div className="h-3 bg-gray-200 rounded animate-pulse w-32" />
          </div>
        </div>
      </div>
    );
  }

  const go = (path) => {
    onClose?.();
    navigate(path);
  };

  const MenuItem = ({ onClick, icon, label, danger = false }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
        danger
          ? 'text-red-500 hover:bg-red-50 hover:text-red-600'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <span className={`shrink-0 ${danger ? 'text-red-400' : 'text-gray-400'}`}>{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/8" style={{ minWidth: 260 }}>

      {/* ── User card ───────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
          {/* Avatar */}
          <div
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
            style={{ background: 'linear-gradient(135deg,#21C1B6,#0d9488)' }}
          >
            {userInitials || (userName || userEmail || 'U').charAt(0).toUpperCase()}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate leading-tight">
              {userName || 'User'}
            </p>
            {userEmail && (
              <p className="text-xs text-gray-400 truncate leading-tight mt-0.5">{userEmail}</p>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {userPlan && (
                <span
                  className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
                  style={{ background: '#dff7f3', color: '#0f766e' }}
                >
                  {userPlan}
                </span>
              )}
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-white border border-gray-200 text-gray-500">
                {accountLabel}
              </span>
            </div>
          </div>

          {/* Online dot */}
          <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-100" />
        </div>
      </div>

      {/* ── Nav items ───────────────────────────────────────── */}
      <div className="px-2 py-1">
        {canViewSettings && (
          <MenuItem
            onClick={() => go('/settings')}
            label="Settings"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          />
        )}
        <MenuItem
          onClick={() => go('/get-help')}
          label="Get help"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <MenuItem
          onClick={() => go('/billing-usage')}
          label="Billing & Usage"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          }
        />
        <MenuItem
          onClick={() => go('/batch-request')}
          label="Batch Requests"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
      </div>

      {/* ── Divider ─────────────────────────────────────────── */}
      <div className="mx-3 my-1 border-t border-gray-100" />

      {/* ── Upgrade plan ────────────────────────────────────── */}
      <div className="px-2 py-1">
        <button
          onClick={() => go('/subscription-plans')}
          className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm font-semibold transition-all group"
          style={{ color: '#0d9488' }}
          onMouseEnter={e => e.currentTarget.style.background = '#f0fdfa'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <div className="flex items-center gap-3">
            <span style={{ color: '#21C1B6' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
            Upgrade plan
          </div>
          <svg className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* ── Divider ─────────────────────────────────────────── */}
      <div className="mx-3 my-1 border-t border-gray-100" />

      {/* ── Log out ─────────────────────────────────────────── */}
      <div className="px-2 pt-1 pb-2">
        <MenuItem
          onClick={handleLogout}
          danger
          label="Log out"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          }
        />
      </div>

    </div>
  );
};

export default UserProfileMenu;
