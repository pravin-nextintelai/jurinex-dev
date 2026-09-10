// import axios from 'axios';
// import { DOCS_BASE_URL, USER_RESOURCES_SERVICE_URL } from '../../config/apiConfig';

// const BASE_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:5000/api';

// const getHeaders = () => {
//   const token = localStorage.getItem('token');
//   return {
//     'Content-Type': 'application/json',
//     ...(token && { Authorization: `Bearer ${token}` })
//   };
// };

// export const fetchFirmUsers = async () => {
//   const response = await axios.get(`${BASE_URL}/rbac/firm/staff`, { headers: getHeaders() });
//   return response.data;
// };

// export const createFirmUser = async (userData) => {
//   const response = await axios.post(`${BASE_URL}/rbac/firm/staff`, userData, { headers: getHeaders() });
//   return response.data;
// };

// export const resendFirmUserPasswordSetupEmail = async (userId) => {
//   const response = await axios.post(
//     `${BASE_URL}/rbac/firm/staff/${userId}/resend-password-setup`,
//     {},
//     { headers: getHeaders() }
//   );
//   return response.data;
// };

// export const deleteFirmUser = async (userId) => {
//   const response = await axios.delete(`${BASE_URL}/rbac/firm/staff/${userId}`, {
//     headers: getHeaders(),
//   });
//   return response.data;
// };

// export const updateUserPermissions = async (userId, permissions) => {
//   const response = await axios.put(`${BASE_URL}/rbac/permissions/${userId}`, { permissions }, { headers: getHeaders() });
//   return response.data;
// };

// export const fetchAssignableCases = async () => {
//   const response = await axios.get(`${DOCS_BASE_URL}/cases/assignable`, {
//     headers: getHeaders(),
//   });
//   return response.data;
// };

// export const fetchUserCaseAssignments = async (userId) => {
//   const response = await axios.get(`${DOCS_BASE_URL}/cases/assignments/${userId}`, {
//     headers: getHeaders(),
//   });
//   return response.data;
// };

// export const updateUserCaseAssignments = async (userId, caseIds) => {
//   const response = await axios.put(
//     `${DOCS_BASE_URL}/cases/assignments/${userId}`,
//     { caseIds },
//     { headers: getHeaders() }
//   );
//   return response.data;
// };

// export const fetchFirmAnalyticsSummary = async (range = '30d') => {
//   const response = await axios.get(`${USER_RESOURCES_SERVICE_URL}/firm-analytics/summary`, {
//     headers: getHeaders(),
//     params: { range },
//   });
//   return response.data;
// };

// export const fetchFirmAnalyticsUsers = async ({ range = '30d', search = '', sortBy = 'tokens_desc' } = {}) => {
//   const response = await axios.get(`${USER_RESOURCES_SERVICE_URL}/firm-analytics/users`, {
//     headers: getHeaders(),
//     params: { range, search, sortBy },
//   });
//   return response.data;
// };

// export const fetchFirmAnalyticsUserDetail = async (userId, range = '30d') => {
//   const response = await axios.get(`${USER_RESOURCES_SERVICE_URL}/firm-analytics/users/${userId}`, {
//     headers: getHeaders(),
//     params: { range },
//   });
//   return response.data;
// };

// export const updateFirmUserTokenLimit = async (userId, payload) => {
//   const response = await axios.put(`${USER_RESOURCES_SERVICE_URL}/firm-analytics/users/${userId}/token-limit`, payload, {
//     headers: getHeaders(),
//   });
//   return response.data;
// };



import axios from 'axios';
import { USER_RESOURCES_SERVICE_URL } from '../../config/apiConfig';

//const BASE_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:5000/api';

const GATEWAY_HOST = (import.meta.env.VITE_GATEWAY_URL || 'http://localhost:5000').replace(/\/$/, '');
const BASE_URL = GATEWAY_HOST.endsWith('/api') ? GATEWAY_HOST : `${GATEWAY_HOST}/api`;

// Case assignment endpoints live in the Node.js document service, which is reachable
// through the gateway at /files/* (not the agentic service at DOCS_BASE_URL/port 8092).
const GATEWAY_FILES_BASE = `${BASE_URL.replace(/\/api$/, '')}/files`;
const getHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };
};

export const fetchFirmUsers = async () => {
  const response = await axios.get(`${BASE_URL}/rbac/firm/staff`, { headers: getHeaders() });
  return response.data;
};

export const createFirmUser = async (userData) => {
  const response = await axios.post(`${BASE_URL}/rbac/firm/staff`, userData, { headers: getHeaders() });
  return response.data;
};

export const resendFirmUserPasswordSetupEmail = async (userId) => {
  const response = await axios.post(
    `${BASE_URL}/rbac/firm/staff/${userId}/resend-password-setup`,
    {},
    { headers: getHeaders() }
  );
  return response.data;
};

export const deleteFirmUser = async (userId) => {
  const response = await axios.delete(`${BASE_URL}/rbac/firm/staff/${userId}`, {
    headers: getHeaders(),
  });
  return response.data;
};

/** Enable (true) or disable (false) a firm staff user. Disabled users cannot log in. */
export const updateFirmUserActiveStatus = async (userId, isActive) => {
  const response = await axios.patch(
    `${BASE_URL}/rbac/firm/staff/${userId}/status`,
    { is_active: isActive },
    { headers: getHeaders() }
  );
  return response.data;
};

export const updateUserPermissions = async (userId, permissions) => {
  const response = await axios.put(`${BASE_URL}/rbac/permissions/${userId}`, { permissions }, { headers: getHeaders() });
  return response.data;
};

export const fetchAssignableCases = async () => {
  const response = await axios.get(`${GATEWAY_FILES_BASE}/cases/assignable`, {
    headers: getHeaders(),
  });
  return response.data;
};

export const fetchUserCaseAssignments = async (userId) => {
  const response = await axios.get(`${GATEWAY_FILES_BASE}/cases/assignments/${userId}`, {
    headers: getHeaders(),
  });
  return response.data;
};

export const updateUserCaseAssignments = async (userId, caseIds) => {
  const response = await axios.put(
    `${GATEWAY_FILES_BASE}/cases/assignments/${userId}`,
    { caseIds },
    { headers: getHeaders() }
  );
  return response.data;
};

export const fetchFirmAnalyticsSummary = async (range = '30d') => {
  const response = await axios.get(`${USER_RESOURCES_SERVICE_URL}/firm-analytics/summary`, {
    headers: getHeaders(),
    params: { range },
  });
  return response.data;
};

export const fetchFirmAnalyticsUsers = async ({ range = '30d', search = '', sortBy = 'tokens_desc' } = {}) => {
  const response = await axios.get(`${USER_RESOURCES_SERVICE_URL}/firm-analytics/users`, {
    headers: getHeaders(),
    params: { range, search, sortBy },
  });
  return response.data;
};

export const fetchFirmAnalyticsUserDetail = async (userId, range = '30d') => {
  const response = await axios.get(`${USER_RESOURCES_SERVICE_URL}/firm-analytics/users/${userId}`, {
    headers: getHeaders(),
    params: { range },
  });
  return response.data;
};

export const updateFirmUserTokenLimit = async (userId, payload) => {
  const response = await axios.put(`${USER_RESOURCES_SERVICE_URL}/firm-analytics/users/${userId}/token-limit`, payload, {
    headers: getHeaders(),
  });
  return response.data;
};

