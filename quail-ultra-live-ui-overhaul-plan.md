# Quail Ultra Live — UI Overhaul Plan

## Context
The app is a React 19 + Bootstrap 5 SPA (Vite, Express backend, SQLite/Neon DB, Railway/Vercel deployable).
Current problems:
- Top bar shows text "Q" instead of the real logo (PNG exists at `/public/branding/quail-ultra.png`)
- Navigation is split across isolated per-page top bars — no persistent nav, no hamburger menu
- Every panel has a verbose subtitle that restates what the title already says
- No dark mode
- Email invites generate a URL but never actually send email (no email library exists)
- Admin panel is a flat dump of sections with no stats or tabs
- No website-provided (library) study packs — everything is user-uploaded only

---

## 1. Logo Fix (`Brand.tsx`)
**`frontend/src/components/Brand.tsx`**
- Replace `<div className="q-brand-mark">Q</div>` with `<img className="q-brand-logo" src="/branding/quail-ultra.png" alt="Quail Ultra" />`
- Make `subtitle` prop optional (`subtitle?: string`) — only render `.q-brand-subtitle` when provided

**`frontend/src/styles/app.css`**
- Replace `.q-brand-mark` style block with `.q-brand-logo` (36×36px, object-fit: contain, no background/border/text styling)

---

## 2. Persistent Left Sidebar + Hamburger Menu

### New `frontend/src/components/AppShell.tsx`
Full-height shell wrapping all non-exam pages:
- **Desktop (≥ 768px):** 240px sidebar, collapses to 60px icon-only via toggle; state persisted to `localStorage`
- **Mobile (< 768px):** sidebar is off-canvas (hidden), hamburger `☰` in top bar slides it in as overlay + backdrop

**Sidebar contents (top → bottom):**
- Logo + "Quail Ultra" wordmark
- **Home** (🏠) — always visible when authenticated
- **Library** (📚) — when authenticated
- **Admin** (⚙️) — when authenticated + `role === 'admin'`
- **Pack context section** (when `?pack=` is in URL): pack name as section header, then Overview / New Block / Previous Blocks nav items
- Divider
- **Dark Mode toggle** (ThemeToggle component)
- **Signed in as `{username}`** label
- **Sign Out** button

**Top bar (slim version inside AppShell):**
- Hamburger button (left) — toggles sidebar
- Page title (center)
- Sync status pill (right, for pack pages)

### Wrap these pages in `<AppShell>`:
- `frontend/src/pages/HomePage.tsx`
- `frontend/src/pages/AdminPage.tsx`
- `frontend/src/pages/OverviewPage.tsx`
- `frontend/src/pages/NewBlockPage.tsx`
- `frontend/src/pages/PreviousBlocksPage.tsx`

`ExamViewPage` keeps its existing full-screen exam shell — **not wrapped**.

### `frontend/src/components/PackTopBar.tsx`
Remove nav pills (navigation moves to sidebar). Repurpose as just the pack page title/back button area, or delete and inline the back button into AppShell's pack context section.

### CSS additions in `frontend/src/styles/app.css`
```
.q-app-shell          — flex row, 100vh
.q-sidebar            — 240px, transition: width 200ms ease
.q-sidebar.collapsed  — 60px
.q-sidebar-overlay    — mobile backdrop (fixed, semi-transparent)
.q-main-content       — flex-grow-1, overflow-y: auto
.q-hamburger          — hamburger button style
```

---

## 3. Remove Subtitle Clutter

Remove all `.q-panel-subtitle` elements that restate the panel title or state the obvious:

| File | Lines to remove |
|------|-----------------|
| `frontend/src/pages/HomePage.tsx` | Remove subtitle from `<Brand>` call (line 221); remove subtitles from "Account Access", "Study Packs", and "Available Study Packs" panels |
| `frontend/src/pages/AdminPage.tsx` | Remove subtitle from `<Brand>` (line 130); remove all 5 section panel subtitles (lines 154, 200, 252, 358, 459) |
| `frontend/src/pages/OverviewPage.tsx` | Remove the "Completed blocks only." / "Mode counts" style subtitles under metric boxes |
| `frontend/src/pages/PreviousBlocksPage.tsx` | Remove subtitle (line ~49) |

---

## 4. Dark Mode

### `frontend/src/lib/theme.ts` (new)
```ts
export function initTheme(): void   // reads localStorage, sets data-theme on <html>
export function toggleTheme(): void // flips theme, persists to localStorage
export function getCurrentTheme(): 'light' | 'dark'
```

### `frontend/src/main.tsx`
Call `initTheme()` before `ReactDOM.createRoot(...)`.

### `frontend/src/components/ThemeToggle.tsx` (new)
Sun/moon icon button wired to `toggleTheme()` with local re-render via `useState`. Placed in sidebar bottom section inside AppShell.

### `frontend/src/styles/app.css`
Add a `[data-theme="dark"]` block overriding all CSS custom properties:
```css
[data-theme="dark"] {
  --q-bg: #111827;
  --q-surface: #1f2937;
  --q-surface-strong: #374151;
  --q-border: #374151;
  --q-border-strong: #4b5563;
  --q-text: #f9fafb;
  --q-text-muted: #9ca3af;
  --q-blue: #60a5fa;
  --q-blue-strong: #93c5fd;
  --q-blue-soft: #1e3a5f;
  --q-success: #34d399;
  --q-success-soft: #064e3b;
  --q-danger: #f87171;
  --q-danger-soft: #7f1d1d;
  --q-amber: #fbbf24;
  --q-amber-soft: #78350f;
  --q-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
}
```
Also override the topbar background, Bootstrap table colors, button variants, and input backgrounds for dark mode.

### `frontend/src/styles/exam-v2.css`
Add dark mode overrides for `--qx-*` variables inside `[data-theme="dark"] body[data-exam-ui="v2"] .exam-v2-shell`.

---

## 5. Email Invite Fix

### `server/config.ts`
Add:
```ts
export function getResendApiKey(): string | null {
  return process.env.RESEND_API_KEY?.trim() || null
}
```

### `server/email.ts` (new)
```ts
export async function sendInviteEmail(to: string, inviteUrl: string): Promise<boolean>
```
- Uses Node's native `fetch()` (Node 24 — no npm dep needed) to POST to `https://api.resend.com/emails`
- Returns `true` if sent, `false` if `RESEND_API_KEY` is not configured
- Throws on API errors (caller wraps in try/catch, logs only — never blocks invite creation)
- Sends a clean HTML email: "You've been invited to Quail Ultra Live. Click to accept: [link]"

### `server/app.ts`
After the `res.status(201).json(...)` in `createAdminInvite` (line ~561):
- Fire-and-forget: `void sendInviteEmail(email, inviteUrl.toString()).catch(console.error)`
- Add `emailSent: boolean` to the JSON response so the frontend can display the right message

### `frontend/src/pages/AdminPage.tsx`
After invite creation, show contextual message:
- `emailSent === true` → "✓ Invite created. Email sent to {email}."
- `emailSent === false` → "Invite created. Copy the URL below (email not configured)."

Add `emailSent?: boolean` to the `InviteCreationResult` type in `frontend/src/types/domain.ts`.

---

## 6. Enhanced Admin Panel (Tabbed Layout)

Convert `frontend/src/pages/AdminPage.tsx` to 5 tabs rendered from a tab bar at the top of the page content area:

### Tab 1 — Overview (new)
Stats cards computed from existing `users` + `invites` state:
- Total Users
- Total Packs (sum of `account.packCount` across all users)
- Open Invites
- Disabled Accounts

### Tab 2 — Users (enhanced)
- Add "Joined" date column to user table
- "View Packs" button expands an inline row below the user showing:
  - Pack name, question count, last updated
  - "Reset Progress" button → calls new `POST /api/admin/packs/:packId/reset` endpoint
  - Progress summary: total blocks run, % questions in "correct" bucket (fetched from `GET /api/admin/packs/:packId/progress-summary`)
- Remove the "Selected User Packs" nested panel at the bottom (replaced by inline expansion)

### Tab 3 — Invites (tidied)
- Keep existing invite table; remove verbose subtitle
- Group visually by status: Open → Used → Revoked

### Tab 4 — Library (new — system packs)
- List of all system packs: name, description, question count, uploaded date, Delete button
- Upload form (reuse existing upload UI pattern) that calls `POST /api/library`

### Tab 5 — Settings
- Registration Mode dropdown + Save Settings button
- Create User form (existing)

### New server endpoints for admin tab enhancements:
- `POST /api/admin/packs/:packId/reset` — proxies existing reset logic for any pack, admin-only
- `GET /api/admin/packs/:packId/progress-summary` — returns `{ totalBlocks, correctCount, totalCount }` for a pack

---

## 7. System / Library Study Packs

### Architecture: Shared workspace, per-user progress
- System packs store question files once at `data/system-packs/{systemPackId}/workspace`
- When a user activates a library pack, a `study_packs` row is created pointing to the **shared** workspace path, but with a separate `progress_override_path` (`data/study-packs/{userPackId}/progress`)
- For regular user-uploaded packs, `progress_override_path` is NULL — existing behavior unchanged

### Database `server/repository.ts`

**New `system_packs` table:**
```sql
CREATE TABLE IF NOT EXISTS system_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  question_count INTEGER NOT NULL DEFAULT 0,
  workspace_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

**New column on `study_packs`:**
```sql
ALTER TABLE study_packs ADD COLUMN progress_override_path TEXT
```
(Added lazily via `IF NOT EXISTS`-style check on `init()`)

**New repository methods:** `createSystemPack`, `listSystemPacks`, `getSystemPackById`, `deleteSystemPack`

### Workspace store `server/workspace-store.ts`
- `loadPack(packRow, blockToOpen)`: read `progress.json` from `packRow.progress_override_path ?? packRow.workspace_path`
- `savePackProgress(progressPath, progress)`: parameter renamed/clarified — callers pass `packRow.progress_override_path ?? packRow.workspace_path`
- All 3 backends (Local, Blob, Railway) updated accordingly

### Server routes `server/app.ts`
- `GET /api/library` — returns all system packs (authenticated users)
- `POST /api/library` — admin uploads a system pack (same upload-then-finalize flow used by user packs; final path: `data/system-packs/{packId}/workspace`)
- `DELETE /api/library/:id` — admin deletes system pack (removes workspace; sets user packs referencing it to a "library_orphaned" state or just removes them with a warning)
- `POST /api/library/:id/import` — user activates a library pack:
  1. Creates `study_packs` row: `workspace_path = systemPack.workspace_path`, `progress_override_path = data/study-packs/{newPackId}/progress`
  2. Creates a blank `progress.json` at `progress_override_path`
  3. Returns the new pack summary

### Frontend

**`frontend/src/lib/api.ts`** — add:
```ts
listLibraryPacks(): Promise<LibraryPackSummary[]>
importLibraryPack(systemPackId: string): Promise<StudyPackSummary>
```

**`frontend/src/pages/LibraryPage.tsx`** (new):
- Grid of system pack cards: name, description, question count, "Add to My Packs" button
- On success: navigate to home so the new pack appears in the list

**`frontend/src/app/App.tsx`**: Add `<Route path="/library" element={<LibraryPage />} />`

**`frontend/src/types/domain.ts`** — add `LibraryPackSummary` type

---

## Critical Files Reference

| File | Role |
|------|------|
| `frontend/src/components/Brand.tsx` | Logo image, optional subtitle |
| `frontend/src/components/PackTopBar.tsx` | Remove nav pills; keep or replace with page heading |
| **NEW** `frontend/src/components/AppShell.tsx` | Sidebar + top bar shell |
| **NEW** `frontend/src/lib/theme.ts` | Dark mode persistence |
| **NEW** `frontend/src/components/ThemeToggle.tsx` | Sun/moon toggle |
| `frontend/src/styles/app.css` | Sidebar CSS + dark mode variable overrides |
| `frontend/src/styles/exam-v2.css` | Dark mode exam variable overrides |
| `frontend/src/main.tsx` | Call `initTheme()` on startup |
| `frontend/src/pages/HomePage.tsx` | Wrap in AppShell, remove subtitles |
| `frontend/src/pages/AdminPage.tsx` | Tabs, stats, subtitle removal, library + progress sections |
| `frontend/src/pages/OverviewPage.tsx` | Wrap in AppShell, remove subtitles |
| `frontend/src/pages/NewBlockPage.tsx` | Wrap in AppShell |
| `frontend/src/pages/PreviousBlocksPage.tsx` | Wrap in AppShell, remove subtitle |
| **NEW** `frontend/src/pages/LibraryPage.tsx` | System packs browse page |
| `frontend/src/app/App.tsx` | Add `/library` route |
| `frontend/src/lib/api.ts` | Library API functions |
| `frontend/src/types/domain.ts` | `LibraryPackSummary`, `emailSent` on invite result |
| `server/app.ts` | Library routes, email sending, admin pack proxy routes |
| `server/repository.ts` | `system_packs` table + methods, `progress_override_path` column |
| `server/workspace-store.ts` | Progress path separation (all 3 backends) |
| **NEW** `server/email.ts` | Resend email via native fetch |
| `server/config.ts` | `getResendApiKey()` |

---

## Verification

1. `npm run dev` — dev server starts cleanly
2. **Logo:** Quail bird PNG appears in sidebar instead of text "Q"
3. **Sidebar desktop:** Collapse toggle works; icon-only mode shows nav icons; expands back to 240px; state persists on refresh
4. **Sidebar mobile:** Hamburger opens overlay drawer; backdrop click closes it
5. **Pack nav:** While on `/overview?pack=xyz`, sidebar shows the pack context section (Overview / New Block / Previous Blocks)
6. **Dark mode:** Toggle sun/moon → all pages (home, admin, exam) switch; refresh → preference persists
7. **No subtitles:** All verbose `.q-panel-subtitle` content is gone
8. **Email invite:** Set `RESEND_API_KEY=re_test_xxx`; create an invite from admin; response includes `emailSent: true` and admin UI shows "Email sent" message
9. **Admin tabs:** Overview stats render; Users tab shows inline pack expansion with progress summary; Invites tab clean; Library tab present; Settings tab functional
10. **Library packs:** Admin uploads system pack via Library tab → user sees it on `/library` → "Add to My Packs" → pack appears on home → open it → study questions → progress saves per-user (admin can view it in Users tab)
11. `npm run typecheck` — zero errors
12. `npm test` — existing tests pass
