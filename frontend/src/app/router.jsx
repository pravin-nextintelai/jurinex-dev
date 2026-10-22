import { Route } from 'react-router-dom';
import AuthChecker from '@/features/auth/components/AuthChecker';
import MainLayout from './layouts/MainLayout';
import PublicLayout from './layouts/PublicLayout';

/**
 * Every feature declares its own pages in `features/<name>/routes.jsx`, so
 * adding a page never means editing this file or App.jsx.
 *
 * A route is `{ path, element, ...options }`:
 *   auth: true           signed-in users only, rendered inside MainLayout
 *   layout: 'full'       MainLayout without page padding
 *   layout: 'none'       no MainLayout (still behind auth when auth is true)
 *   publicLayout: {...}  wrap in PublicLayout with these props
 */
const featureRoutes = import.meta.glob('../features/*/routes.jsx', { eager: true, import: 'default' });

export const routes = Object.values(featureRoutes).flat();

if (import.meta.env.DEV) {
  const seen = new Set();
  for (const { path } of routes) {
    if (seen.has(path)) console.warn(`[router] "${path}" is registered by more than one feature`);
    seen.add(path);
  }
}

function wrap({ element, auth, layout, publicLayout }) {
  let page = element;
  if (publicLayout) page = <PublicLayout {...publicLayout}>{page}</PublicLayout>;
  if (auth) {
    if (layout !== 'none') page = <MainLayout useNoPadding={layout === 'full'}>{page}</MainLayout>;
    page = <AuthChecker>{page}</AuthChecker>;
  }
  return page;
}

export const routeElements = routes.map((route) => (
  <Route key={route.path} path={route.path} element={wrap(route)} />
));
