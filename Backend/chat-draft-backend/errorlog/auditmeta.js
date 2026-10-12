'use strict';
/** Fill audit log ACTION / RESOURCE TYPE / METHOD for the admin table. */

const HTTP_ACTION = {
  GET: 'VIEW', HEAD: 'VIEW', POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE',
};

const TYPE_ALIAS = {
  FOLDER: 'STORAGE FOLDER', FOLDER_NAME: 'STORAGE FOLDER', STORAGE: 'STORAGE FOLDER',
  STORAGE_FOLDER: 'STORAGE FOLDER', CASE: 'CASE', CASES: 'CASE', CASE_ID: 'CASE',
  FILE: 'FILE', FILE_ID: 'FILE', DOCUMENT: 'FILE', DOC: 'FILE', USER: 'USER',
  USERS: 'USER', SESSION: 'CHAT', CHAT: 'CHAT', PROMPT: 'PROMPT', PLAN: 'PLAN',
  PAYMENT: 'PAYMENT', TICKET: 'SUPPORT TICKET', SUPPORT: 'SUPPORT TICKET',
};

const PATH_RESOURCES = [
  [/\/files\/cases(?:\/|$)|\/cases(?:\/|$)/i, 'CASE'],
  [/\/files\/folders(?:\/|$)|\/storage[-_]?folders?(?:\/|$)|\/folders(?:\/|$)/i, 'STORAGE FOLDER'],
  [/\/files\/file(?:\/|$)|\/documents?(?:\/|$)|\/docs(?:\/|$)/i, 'FILE'],
  [/\/files(?:\/|$)/i, 'STORAGE FOLDER'],
  [/\/users?(?:\/|$)/i, 'USER'],
  [/\/sessions?(?:\/|$)|\/chats?(?:\/|$)/i, 'CHAT'],
  [/\/prompts?(?:\/|$)/i, 'PROMPT'],
  [/\/plans?(?:\/|$)|\/billing(?:\/|$)|\/subscriptions?(?:\/|$)/i, 'PLAN'],
  [/\/payments?(?:\/|$)/i, 'PAYMENT'],
  [/\/tickets?(?:\/|$)|\/support(?:\/|$)/i, 'SUPPORT TICKET'],
  [/\/templates?(?:\/|$)/i, 'TEMPLATE'],
  [/\/drafts?(?:\/|$)/i, 'DRAFT'],
];

const RESOURCE_SERVICE = {
  'STORAGE FOLDER': 'FolderService',
  CASE: 'CaseService',
  FILE: 'FolderService',
  USER: 'UserService',
  CHAT: 'ChatService',
  PROMPT: 'PromptService',
  PLAN: 'PlanService',
  PAYMENT: 'PaymentService',
  'SUPPORT TICKET': 'SupportService',
  TEMPLATE: 'TemplateService',
  DRAFT: 'DraftService',
};

const SKIP_OWNERS = new Set(['app', 'api', 'src', 'routes', 'controllers', 'hooks', 'v1', 'main', 'server', 'index']);
const PARAM_RE = /^\{.+\}$/;
const UUIDISH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{4,}$/i;

function actionFromHttp(httpMethod) {
  if (!httpMethod) return null;
  const m = String(httpMethod).toUpperCase();
  return HTTP_ACTION[m] || m.slice(0, 30);
}

function titleService(name) {
  const parts = String(name || '').split(/[-_]+/).filter(Boolean);
  if (!parts.length) return 'Service';
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function singular(word) {
  const w = String(word || '').replace(/-/g, '_');
  if (w.endsWith('ies') && w.length > 3) return `${w.slice(0, -3)}y`;
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 1) return w.slice(0, -1);
  return w;
}

function pathSegments(endpoint, route) {
  const raw = String(route || endpoint || '').split('?')[0];
  return raw.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

function functionFromHandler(routeMethod) {
  const raw = String(routeMethod || '').trim();
  if (!raw) return null;
  if (/\s/.test(raw) && !raw.includes('<locals>')) return raw.split(/\s+/).pop();
  const parts = raw.replace(/\\/g, '/').replace(/\//g, '.').split('.').filter((p) => p && p !== '<locals>');
  return parts.length ? parts[parts.length - 1] : null;
}

function functionFromPath(httpMethod, endpoint, route) {
  const segs = pathSegments(endpoint, route);
  if (!segs.length) return null;
  const staticSegs = segs.filter((s) => !PARAM_RE.test(s) && !UUIDISH_RE.test(s) && !/^\d+$/.test(s));
  let last = (staticSegs[staticSegs.length - 1] || segs[segs.length - 1] || '').replace(/-/g, '_');
  if (['api', 'files', 'v1'].includes(last)) return null;
  const verb = String(httpMethod || 'GET').toUpperCase();
  const hasId = segs.some((s) => PARAM_RE.test(s) || UUIDISH_RE.test(s) || /^\d+$/.test(s));
  if (verb === 'GET' || verb === 'HEAD') {
    if (hasId) return `get_${singular(last)}`;
    return ['get', 'list'].includes(last) ? last : `list_${last}`;
  }
  if (verb === 'POST') {
    if (/^(create_|list_|get_)/.test(last) || ['create', 'upload', 'import'].includes(last)) return last;
    return `create_${singular(last)}`;
  }
  if (verb === 'PUT' || verb === 'PATCH') return `update_${singular(last)}`;
  if (verb === 'DELETE') return `delete_${singular(last)}`;
  return last;
}

function displayMethod(routeMethod, {
  serviceName, httpMethod, resourceType, endpoint, route,
} = {}) {
  let fn = functionFromHandler(routeMethod) || functionFromPath(httpMethod, endpoint, route);
  const svc = RESOURCE_SERVICE[resourceType] || titleService(String(serviceName || 'service').replace(/-service$/, '_service'));
  if (!fn) {
    if (!serviceName && !httpMethod) return null;
    fn = String(httpMethod || 'GET').toLowerCase();
  }
  if (SKIP_OWNERS.has(fn)) fn = String(httpMethod || 'GET').toLowerCase();
  return `${svc}.${fn}`.slice(0, 255);
}

function resourceFromRequest({ endpoint, route, resourceType, resourceId } = {}) {
  const rid = resourceId === '' || resourceId === undefined ? null : resourceId;
  if (resourceType) {
    const key = String(resourceType).replace(/[-\s]+/g, '_').toUpperCase();
    return [TYPE_ALIAS[key] || String(resourceType).toUpperCase().slice(0, 50), rid];
  }
  const hay = `${route || ''} ${endpoint || ''}`;
  for (const [rx, name] of PATH_RESOURCES) {
    if (rx.test(hay)) return [name, rid];
  }
  return [null, rid];
}

function enrich({
  httpMethod, endpoint, route, resourceType, resourceId, action, routeMethod, serviceName,
} = {}) {
  const [rtype, rid] = resourceFromRequest({ endpoint, route, resourceType, resourceId });
  return {
    action: action || actionFromHttp(httpMethod),
    resource_type: rtype,
    resource_id: rid,
    method: displayMethod(routeMethod, {
      serviceName, httpMethod, resourceType: rtype, endpoint, route,
    }),
  };
}

module.exports = { actionFromHttp, displayMethod, resourceFromRequest, enrich };
