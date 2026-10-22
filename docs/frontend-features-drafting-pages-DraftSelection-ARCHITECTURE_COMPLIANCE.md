# Frontend Architecture Compliance

This document ensures the frontend implementation follows the backend architecture rules.

## ✅ Golden Rules (Implemented)

### 1. Backend Owns Truth
- ✅ All mutations call backend APIs
- ✅ Always refetch after mutations (never mutate locally)
- ✅ Server response is source of truth

### 2. Every Edit = New Version
- ✅ `PUT /api/drafts/:id/fields` creates new version
- ✅ Frontend refetches draft after field updates
- ✅ Version history tracked by backend

### 3. Blocks Are Immutable (Except content.value)
- ✅ Frontend never reorders blocks
- ✅ Frontend never moves blocks across pages
- ✅ Frontend never changes block structure
- ✅ Only `content.value` can be updated via API

### 4. Always Refetch After Mutation
- ✅ Field updates → refetch draft
- ✅ AI insert → refetch draft  
- ✅ Undo/Redo → refetch draft
- ✅ Never mutate blocks locally

### 5. Never Locally Reorder Blocks
- ✅ Blocks grouped by `content.pageNo` (from backend)
- ✅ Blocks rendered in order received
- ✅ No client-side sorting or reordering

### 6. Never Calculate Page Layout
- ✅ Use `content.pageNo` from backend normalizer
- ✅ Render one `.a4-page` per pageNo
- ✅ Backend handles pagination

## 🔄 Current Flow Implementation

### 1️⃣ Template Listing ✅
- `GET /api/templates` → Shows grid/cards
- User clicks template → Loads full template

### 2️⃣ Create Draft ✅
- `POST /api/drafts` → Creates draft from template
- Backend normalizes pages → flat blocks
- Frontend navigates to draft editor

### 3️⃣ Draft Editor ✅
- `GET /api/drafts/:id` → Loads everything (schema, blocks, status)
- Three-panel layout: Preview | Form | AI

### 4️⃣ Preview Rendering ✅
- Groups blocks by `content.pageNo`
- Renders one A4 page per pageNo
- Never reorders blocks
- Uses template `fallback_html` when available

### 5️⃣ Form Panel ✅
- Schema-driven form generation
- Maps `block.key === field.key`
- Values from `block.content.value`

### 6️⃣ Field Updates ✅
- Debounced (300ms)
- `PUT /api/drafts/:id/fields`
- **Always refetches** `GET /api/drafts/:id` after update
- Never mutates blocks locally

### 7️⃣ AI Suggestions (TODO)
- `POST /api/drafts/:id/ai/suggest`
- Shows pending suggestions
- Insert → `POST /api/drafts/:id/ai/:sid/insert` → refetch

### 8️⃣ Undo/Redo (TODO)
- `POST /api/drafts/:id/undo` → refetch
- `POST /api/drafts/:id/redo` → refetch
- Frontend does NOT manage history

## 📋 Checklist

- [x] Template listing works
- [x] Draft creation works
- [x] Draft loading works
- [x] Preview rendering (groups by pageNo)
- [x] Form panel (schema-driven)
- [x] Field updates (debounced, refetches)
- [ ] AI suggestions integration
- [ ] Undo/Redo integration
- [ ] Evidence upload (for AI context)
- [ ] Preview endpoint (`GET /api/drafts/:id/preview`)
- [ ] Export (`POST /api/drafts/:id/export`)
- [ ] Finalize (`POST /api/drafts/:id/finalize`)

## 🚨 Critical Rules (Never Violate)

1. **Never mutate blocks locally** - Always refetch
2. **Never reorder blocks** - Use backend order
3. **Never calculate pages** - Use `content.pageNo`
4. **Never skip refetch** - After every mutation
5. **Backend owns truth** - Server response is authoritative
