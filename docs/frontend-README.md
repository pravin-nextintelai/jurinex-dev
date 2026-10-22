# JuriNex Frontend

React + Vite. `npm run dev` to start, `npm run build` to build.

## Folder structure

```
src/
├── main.jsx            entry point
├── app/                app shell: App.jsx, router.jsx, layouts/ (MainLayout, Sidebar, PublicLayout)
├── features/           one folder per feature — this is where you work
│   ├── auth/  landing/  dashboard/  cases/  case-storage/  analysis/  chat/
│   ├── chronology/  citations/  drafting/  template-drafting/  template-builder/
│   └── ocr-viewer/  billing/  branding/  batch/  translation/  user-management/  help/  settings/
├── shared/             code used by two or more features (no feature logic)
│   ├── api/  components/  context/  hooks/  styles/  utils/
├── config/             apiConfig, firebase
└── assets/             images, fonts
```

Every feature uses the same layout. Only create the folders you need:

```
features/<name>/
├── pages/        full pages (route targets)
├── components/   UI used only by this feature
├── hooks/
├── api/          this feature's backend calls
├── utils/
├── styles/
└── routes.jsx    this feature's URLs
```

## Adding a page

Add it to your feature's `routes.jsx`. It is picked up automatically, so you never edit `App.jsx`.

```jsx
// features/chronology/routes.jsx
import TimelinePage from './pages/TimelinePage';

export default [
  { path: '/timeline', element: <TimelinePage />, auth: true },
];
```

| Option | Meaning |
| --- | --- |
| `auth: true` | signed-in users only, shown inside MainLayout |
| `layout: 'full'` | MainLayout without page padding |
| `layout: 'none'` | no MainLayout |
| `publicLayout: { ... }` | wrap in PublicLayout with these props |

## Team rules

1. Work inside `features/<your-feature>/`.
2. Imports inside your feature are relative (`./components/X`). Imports from anywhere else use `@/` (`@/shared/api/api`, `@/features/billing/components/X`).
3. Move code to `shared/` only when a second feature needs it. `shared/` must never import from `features/`.
4. Each feature keeps its own API calls in its `api/` folder. Only cross-feature clients live in `shared/api/`.
5. Names: `PascalCase.jsx` for components, `useX.js` for hooks, `xxxApi.js` for API files.

## Local service URLs

Original                   Replace With

http://localhost:5000	gateway-service
http://localhost:5002	document-service
http://localhost:5017	drafting-agents (Template Analyzer)
http://localhost:8000	all-drafting-agent (agent-draft-service: templates, drafts)

## Google Drive Picker Env

Set these in `frontend/.env` before using Google Drive picker integrations:

```
VITE_GOOGLE_DRIVE_API_KEY=AIza...
```

Notes:
- `VITE_GOOGLE_DRIVE_API_KEY` must be a browser API key from Google Cloud with Drive Picker/Drive API access enabled.
- `VITE_GOOGLE_API_KEY` is still accepted as a legacy fallback, but `VITE_GOOGLE_DRIVE_API_KEY` is preferred.
- Restart the frontend dev server after changing env vars.
