# Sidebar Integration for Draft Components

## 📌 Quick Update Guide

### Current Sidebar Configuration
The sidebar currently has "Document Drafting" pointing to `/drafts` (line 259 in Sidebar.jsx).

### Option 1: Update Existing Link (Recommended)
Change the path to point to the new draft selection page:

```javascript
// In Sidebar.jsx, line 259
// BEFORE:
{ name: 'Document Drafting', path: '/drafts', icon: PencilSquareIcon },

// AFTER:
{ name: 'Document Drafting', path: '/draft-selection', icon: PencilSquareIcon },
```

This will make the sidebar link take users to the new card selection page where they can choose between Google Docs, Microsoft Word, or Templates.

### Option 2: Add Additional Menu Items
If you want to keep the existing `/drafts` route AND add the new selection page, you can add it as a separate menu item:

```javascript
// In Sidebar.jsx, around line 259
const menuItems = [
  // ... other items
  { name: 'Chats', path: '/chats', icon: MessageSquare, isSpecial: true },
  { name: 'Tools', path: '/tools', icon: Cog6ToothIcon },
  { name: 'Draft Selection', path: '/draft-selection', icon: PencilSquareIcon },
  { name: 'My Drafts', path: '/drafts', icon: DocumentTextIcon }, // Keep existing
  { name: 'Billing & Usage', path: '/billing-usage', icon: CreditCardIcon },
];
```

### Option 3: Nested Menu (Advanced)
Create a nested menu for drafting options:

```javascript
// Add to Sidebar.jsx
const [isDraftingExpanded, setIsDraftingExpanded] = useState(false);

// In the menu items section:
{
  name: 'Document Drafting',
  icon: PencilSquareIcon,
  subItems: [
    { name: 'Draft Selection', path: '/draft-selection' },
    { name: 'Google Docs', path: '/draft/google-docs' },
    { name: 'Microsoft Word', path: '/draft/microsoft-word' },
    { name: 'My Drafts', path: '/drafts' },
  ]
}
```

## 🎯 Recommended Approach

**Use Option 1** - Simply update the existing link:

```javascript
// File: Frontend/src/components/Sidebar.jsx
// Line: ~259

{ name: 'Document Drafting', path: '/draft-selection', icon: PencilSquareIcon },
```

This provides the best user experience:
1. User clicks "Document Drafting" in sidebar
2. Sees 3 cards to choose from (Google Docs, MS Word, Templates)
3. Clicks preferred platform
4. Starts creating documents

## 🔄 Navigation Flow

```
Sidebar Click "Document Drafting"
    ↓
/draft-selection (Card Selection Page)
    ↓
    ├─→ /draft/google-docs (Google Docs Interface)
    ├─→ /draft/microsoft-word (MS Word Interface)
    └─→ /draft/templates (Coming Soon)
```

## 📝 Quick Implementation

1. Open `Frontend/src/components/Sidebar.jsx`
2. Find line 259: `{ name: 'Document Drafting', path: '/drafts', icon: PencilSquareIcon }`
3. Change to: `{ name: 'Document Drafting', path: '/draft-selection', icon: PencilSquareIcon }`
4. Save the file

That's it! The sidebar will now navigate users to the beautiful card selection page.

## 🎨 Alternative: Add Quick Access Icons

For even better UX, you could add quick access buttons in the header or a dedicated drafting section:

```javascript
// Quick access buttons (can be added to header or QuickTools)
<Button onClick={() => navigate('/draft/google-docs')}>
  <GoogleIcon /> Google Docs
</Button>
<Button onClick={() => navigate('/draft/microsoft-word')}>
  <MicrosoftIcon /> MS Word
</Button>
```

## ✅ Testing Checklist

After making changes:
- [ ] Click "Document Drafting" in sidebar
- [ ] Verify you land on `/draft-selection`
- [ ] See 3 cards displayed
- [ ] Click "Google Docs" card → Goes to `/draft/google-docs`
- [ ] Click "Microsoft Word" card → Goes to `/draft/microsoft-word`
- [ ] Back button works from each platform page
- [ ] Responsive design works on mobile

---

**Status:** Ready to integrate
**Effort:** 1 line change (Option 1)
**Impact:** Improved user experience with visual platform selection


