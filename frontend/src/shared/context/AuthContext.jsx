import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/api';
import { API_BASE_URL, USER_RESOURCES_SERVICE_URL } from '@/config/apiConfig';
import { shouldEnforceRbac } from '../utils/permissions';
import { getPlanDisplayName } from '../utils/planUtils';
import {
  clearScopedPlanInfo,
  getStoredUserId,
  readScopedPlanInfo,
  writeScopedPlanInfo,
} from '../utils/planStorage';
import { AuthContext } from './authContext';
import { invalidateLlmChatLimitsCache } from '../api/llmChatLimitsService';
const ACTIVITY_PING_INTERVAL_MS = 15 * 1000;

// Every key any API client may read an identity from. getUserIdForDrafting /
// getAuthHeader fall back through these — a stale one left behind on account
// switch makes the NEW login send the OLD user's X-User-Id (seen live:
// a fresh account listing another user's cases).
const LEGACY_AUTH_KEYS = ['userInfo', 'authToken', 'access_token', 'jwt', 'auth_token'];

const purgeStaleIdentity = () => {
  LEGACY_AUTH_KEYS.forEach((k) => localStorage.removeItem(k));
  try {
    // Per-tab research state is account-specific — never carry it across.
    sessionStorage.removeItem('jurinex.citationResearch.v1');
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith('jurinex.reviewStatuses.'))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch { /* non-fatal */ }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [planInfo, setPlanInfo] = useState(null);

  const persistUser = (userData) => {
    setUser(userData);
    if (userData) {
      localStorage.setItem('user', JSON.stringify(userData));
    } else {
      localStorage.removeItem('user');
    }
  };

  const fetchCurrentUserPermissions = async (authToken) => {
    if (!authToken) return null;

    const response = await fetch(`${API_BASE_URL}/api/rbac/permissions/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch permissions: ${response.status}`);
    }

    const data = await response.json();
    return data.permissions || {};
  };

  const hydratePermissions = async (authToken, baseUser) => {
    if (!authToken || !baseUser) return baseUser;
    if (!shouldEnforceRbac(baseUser)) return baseUser;

    try {
      const permissions = await fetchCurrentUserPermissions(authToken);
      const nextUser = { ...baseUser, permissions };
      persistUser(nextUser);
      return nextUser;
    } catch (error) {
      console.error('❌ AuthContext: Error fetching current user permissions:', error);
      return baseUser;
    }
  };

  const fetchAndStorePlan = useCallback(async (authToken) => {
    try {
      if (!authToken) {
        console.log('⚠️ AuthContext: No token provided for plan fetch');
        return null;
      }

      console.log('🔄 AuthContext: Fetching plan from API...');
      const response = await fetch(`${USER_RESOURCES_SERVICE_URL}/plan-details`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (!response.ok) {
        console.error('❌ AuthContext: Failed to fetch plan from API:', response.status);
        return null;
      }

      const data = await response.json();
      console.log('✅ AuthContext: Fetched plan data from API:', data);

      const activePlan = data.activePlan || data.userSubscription || data.subscription;
      const planId = activePlan?.plan_id ?? activePlan?.id ?? null;
      const hasPaidPlan = planId != null && Number(planId) > 0;

      if (!activePlan || !hasPaidPlan) {
        clearScopedPlanInfo();
        setPlanInfo(null);
        console.log('✅ AuthContext: No active subscription — plan cache cleared');
        return null;
      }

      if (activePlan && (activePlan.plan_name || activePlan.planName || activePlan.name || hasPaidPlan)) {
        const planName =
          activePlan.plan_name ||
          activePlan.planName ||
          activePlan.name ||
          (hasPaidPlan ? `Plan #${planId}` : 'Active plan');
        const planLabel = getPlanDisplayName(activePlan) || planName;
        // Ignore dev/mock gateway labels when a real plan id exists
        const isMockDevPlan =
          hasPaidPlan &&
          ['development', 'developer'].includes(String(planLabel || '').toLowerCase());
        const finalLabel = isMockDevPlan ? planName : planLabel;
        const planData = {
          plan: finalLabel,
          planName,
          planId,
          isInheritedFromFirm: !!activePlan.is_inherited_from_firm,
          lastPayment: data.latestPayment || activePlan.lastPayment || data.lastPayment,
          subscription: activePlan
        };
        
        setPlanInfo(planData);
        invalidateLlmChatLimitsCache();

        const userId = getStoredUserId();
        if (userId != null) {
          writeScopedPlanInfo(userId, {
            plan: finalLabel,
            planName,
            planId,
            lastPayment: planData.lastPayment,
            isInheritedFromFirm: planData.isInheritedFromFirm,
          });
          console.log('✅ AuthContext: Updated scoped plan cache:', finalLabel);
        }

        console.log('✅ AuthContext: Plan stored in RAM:', finalLabel);
        return planData;
      }

      return null;
    } catch (error) {
      console.error('❌ AuthContext: Error fetching plan from API:', error);
      return null;
    }
  }, []);

  const refreshPlan = useCallback(
    async (authToken = token) => fetchAndStorePlan(authToken || localStorage.getItem('token')),
    [token, fetchAndStorePlan]
  );

  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      console.log('AuthContext: Initializing from localStorage - Token:', storedToken ? 'Present' : 'Not Present');

      if (storedToken) {
        setToken(storedToken);
        
        if (storedUser) {
          try {
            const parsedUser = JSON.parse(storedUser);
            persistUser(parsedUser);
            console.log('AuthContext: User restored from localStorage:', parsedUser.email);

            const scopedPlan = readScopedPlanInfo(parsedUser?.id);
            if (scopedPlan?.plan && scopedPlan?.planId > 0) {
              setPlanInfo({
                plan: scopedPlan.plan,
                planName: scopedPlan.planName,
                planId: scopedPlan.planId,
                lastPayment: scopedPlan.lastPayment,
                isInheritedFromFirm: scopedPlan.isInheritedFromFirm,
              });
              console.log('✅ AuthContext: Plan restored for user', parsedUser.id, ':', scopedPlan.plan);
            }

            hydratePermissions(storedToken, parsedUser).catch((err) => {
              console.error('AuthContext: Background permission fetch failed:', err);
            });
          } catch (e) {
            console.error('AuthContext: Failed to parse user from localStorage', e);
            localStorage.removeItem('user');
            localStorage.removeItem('token');
            clearScopedPlanInfo();
            setToken(null);
            setUser(null);
          }
        }

        fetchAndStorePlan(storedToken).catch(err => {
          console.error('AuthContext: Background plan fetch failed:', err);
        });
      }
      
      setLoading(false);
    };

    initializeAuth();
  }, []);

  useEffect(() => {
    if (!token || loading) return undefined;

    const pingActivity = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      try {
        await fetch(`${API_BASE_URL}/api/auth/activity/ping`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
      } catch (error) {
        console.warn('AuthContext: Activity ping failed:', error.message);
      }
    };

    pingActivity();
    const intervalId = window.setInterval(pingActivity, ACTIVITY_PING_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pingActivity();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, loading]);

  const login = async (email, password) => {
    try {
      const response = await api.login({ email, password });
      
      if (response.requiresOtp) {
        console.log('AuthContext: OTP required for login.');
        return { 
          success: false, 
          requiresOtp: true, 
          firstLogin: response.firstLogin || false,
          email: email, 
          message: response.message || 'OTP required. Please check your email.' 
        };
      }
      
      if (response.token) {
        purgeStaleIdentity();
        clearScopedPlanInfo();
        setPlanInfo(null);
        setToken(response.token);
        persistUser(response.user);

        localStorage.setItem('token', response.token);

        console.log('AuthContext: Login successful, token stored:', response.token);

        await hydratePermissions(response.token, response.user);
        
        fetchAndStorePlan(response.token).catch(err => {
          console.error('AuthContext: Plan fetch after login failed:', err);
        });
        
        return { success: true, user: response.user, token: response.token };
      }
      
      return { success: false, message: response.message || 'Login failed: No token received.' };
    } catch (error) {
      console.error('AuthContext: Login failed:', error);
      const code = error.code || error.response?.data?.code;
      const status = error.response?.status;
      if (code === 'FIRM_DISABLED' || code === 'USER_DISABLED' || code === 'FIRM_NOT_APPROVED' || status === 403) {
        let message = error.message || 'Login failed.';
        if (code === 'FIRM_DISABLED') {
          message = 'Your firm is blocked by Jurinex. Please contact your firm admin.';
        } else if (code === 'FIRM_NOT_APPROVED') {
          message = error.message || 'Your firm is not approved yet.';
        } else if (code === 'USER_DISABLED' || status === 403) {
          message = error.message || 'Your account is disabled. Contact your firm admin or support.';
        }
        return {
          success: false,
          code: code || 'USER_DISABLED',
          message,
        };
      }
      return { success: false, message: error.message || 'Login failed.', code };
    }
  };

  const verifyOtp = async (email, otp, newPassword = null) => {
    try {
      const response = await api.verifyOtp(email, otp, newPassword);
      
      if (response.success && response.token) {
        purgeStaleIdentity();
        clearScopedPlanInfo();
        setPlanInfo(null);
        setToken(response.token);
        persistUser(response.user);
        
        localStorage.setItem('token', response.token);
        
        console.log('AuthContext: OTP verification successful, token stored:', response.token);

        await hydratePermissions(response.token, response.user);
        
        fetchAndStorePlan(response.token).catch(err => {
          console.error('AuthContext: Plan fetch after OTP verification failed:', err);
        });
        
        return { success: true, user: response.user, token: response.token };
      }
      
      return { success: false, message: response.message || 'OTP verification failed.' };
    } catch (error) {
      console.error('AuthContext: OTP verification failed:', error);
      const code = error.code || error.response?.data?.code;
      const status = error.response?.status;
      if (code === 'FIRM_DISABLED' || code === 'USER_DISABLED' || code === 'FIRM_NOT_APPROVED' || status === 403) {
        let message = error.message || 'OTP verification failed.';
        if (code === 'FIRM_DISABLED') {
          message = 'Your firm is blocked by Jurinex. Please contact your firm admin.';
        } else if (code === 'FIRM_NOT_APPROVED') {
          message = error.message || 'Your firm is not approved yet.';
        } else {
          message = error.message || 'Your account is disabled. Contact your firm admin or support.';
        }
        return {
          success: false,
          code: code || 'USER_DISABLED',
          message,
        };
      }
      return { success: false, message: error.message || 'OTP verification failed.', code };
    }
  };

  const setAuthState = (authToken, userData) => {
    console.log('AuthContext: Manually setting auth state for user:', userData.email);

    purgeStaleIdentity();
    clearScopedPlanInfo();
    setPlanInfo(null);
    setToken(authToken);
    persistUser(userData);
    
    localStorage.setItem('token', authToken);

    hydratePermissions(authToken, userData).catch(err => {
      console.error('AuthContext: Permission fetch after setAuthState failed:', err);
    });
    
    fetchAndStorePlan(authToken).catch(err => {
      console.error('AuthContext: Plan fetch after setAuthState failed:', err);
    });
    
    console.log('AuthContext: Auth state manually updated');
  };

  const logout = () => {
    persistUser(null);
    setToken(null);
    setPlanInfo(null);
    clearScopedPlanInfo();
    purgeStaleIdentity();

    localStorage.removeItem('token');
    
    console.log('AuthContext: User logged out, all data cleared.');
  };

  const isAuthenticated = !loading && token && user;

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      isAuthenticated,
      planInfo,
      login,
      logout,
      verifyOtp,
      setAuthState,
      fetchAndStorePlan,
      refreshPlan,
      hydratePermissions,
    }),
    [
      user,
      token,
      loading,
      isAuthenticated,
      planInfo,
      login,
      logout,
      verifyOtp,
      setAuthState,
      fetchAndStorePlan,
      refreshPlan,
      hydratePermissions,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
