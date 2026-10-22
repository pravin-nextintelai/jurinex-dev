/**
 * Template Drafting Component - API Client
 * Base configuration for all API calls.
 * Custom Template Isolation: sends Authorization and X-User-Id for unified template/sections APIs.
 */

/// <reference path="../vite-env.d.ts" />

import axios, { AxiosInstance, AxiosError } from 'axios';
import { Logger } from '../utils/logger';

// Agent-draft-service (API_POSTMAN.md): drafts, sections, templates, fields, autopopulation
import { AGENT_DRAFT_TEMPLATE_API, getUserIdForDrafting } from '@/config/apiConfig';
export const DRAFTING_API_BASE = `${AGENT_DRAFT_TEMPLATE_API}/api`;

function getAuthToken(): string | null {
    return (
        localStorage.getItem('token') ||
        localStorage.getItem('authToken') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('jwt') ||
        localStorage.getItem('auth_token') ||
        null
    );
}

/**
 * Create axios instance with auth and error handling
 */
export const createApiClient = (): AxiosInstance => {
    const client = axios.create({
        baseURL: DRAFTING_API_BASE,
        timeout: 120000,
        headers: {
            'Content-Type': 'application/json'
        }
    });

    // Auth interceptor - add JWT and X-User-Id (for custom template fetching)
    client.interceptors.request.use(
        (config) => {
            const token = getAuthToken();
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            const userId = getUserIdForDrafting();
            if (userId) {
                config.headers['X-User-Id'] = userId;
            }
            return config;
        },
        (error) => {
            Logger.error('API_REQUEST_ERROR', { error: error.message });
            return Promise.reject(error);
        }
    );

    // Response interceptor - handle errors
    client.interceptors.response.use(
        (response) => response,
        (error: AxiosError) => {
            const errorData = error.response?.data as any;
            const detail = errorData?.detail;
            const message = typeof detail === 'string' ? detail : (errorData?.message || error.message);

            Logger.error('API_RESPONSE_ERROR', {
                url: error.config?.url,
                method: error.config?.method,
                status: error.response?.status,
                code: errorData?.code,
                message,
                detail: errorData?.detail
            });

            return Promise.reject(error);
        }
    );

    return client;
};

// Singleton instance
export const api = createApiClient();

/**
 * Helper: Extract error message from API error (supports FastAPI detail, Axios, etc.)
 */
export const getErrorMessage = (error: unknown): string => {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data;
        // FastAPI returns { detail: "..." } or { detail: [...] }
        if (data != null && typeof data === 'object' && !Array.isArray(data)) {
            const detail = (data as any).detail;
            if (detail != null) {
                if (typeof detail === 'string') return detail;
                if (Array.isArray(detail) && detail.length > 0) {
                    const first = detail[0];
                    return typeof first === 'string' ? first : (first?.msg ?? String(first));
                }
            }
            const msg = (data as any).message || (data as any).error;
            if (typeof msg === 'string') return msg;
        }
        // Some servers return plain string or HTML
        if (typeof data === 'string' && data.length > 0 && data.length < 500) {
            const trimmed = data.trim();
            if (trimmed.startsWith('{')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    return parsed.detail || parsed.message || parsed.error || trimmed;
                } catch {
                    return trimmed;
                }
            }
            return trimmed;
        }
        // No response (network error, timeout, CORS)
        if (!error.response) {
            return error.code === 'ECONNABORTED'
                ? 'Request timed out. Please try again.'
                : error.message || 'Network error. Check your connection.';
        }
        return error.message || `Request failed (${error.response.status})`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'An unexpected error occurred';
};

/**
 * Helper: true if error is a request timeout (frontend gave up waiting; backend may still complete)
 */
export const isTimeoutError = (error: unknown): boolean => {
    return axios.isAxiosError(error) && error.code === 'ECONNABORTED';
};

/**
 * Helper: Extract error code from API error
 */
export const getErrorCode = (error: unknown): string | undefined => {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as any;
        return data?.code;
    }
    return undefined;
};
