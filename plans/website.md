# Website — DevTool Loop Dashboard (Vite + React)

## Architecture

```
rantify-ui/              ← NEW: Vite + React project, deployed to Vercel
  src/
    main.jsx
    App.jsx
    api.js               ← fetch wrapper pointing to backend
    pages/
      Dashboard.jsx      ← kanban board by status
      CardDetail.jsx     ← card view + actions + spec viewer
      SubmitForm.jsx     ← manual idea submission
      OAuthStatus.jsx    ← connected GitHub accounts
    components/
      Card.jsx           ← compact card for kanban
      KanbanColumn.jsx
      Layout.jsx         ← nav header
  vite.config.js
  vercel.json            ← SPA rewrite rules

orchestrator/            ← existing backend (add CORS + API routes)
  api.mjs                ← NEW: standalone API route handlers
  server.mjs             ← ADD: CORS headers + route to api module
  index.mjs              ← WIRE: box client + token store into api module
```

**No frontend build artifacts in the orchestrator repo.** `rantify-ui` is a separate directory, independent deploy to Vercel.

---

## API Contract

All routes `GET/POST /api/*` on the orchestrator:

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| `GET` | `/api/cards` | All cards across all statuses | `CardListItem[]` |
| `GET` | `/api/cards/:fileId` | Single card detail | `CardDetail` |
| `GET` | `/api/cards/:fileId/spec` | Card spec.md | `{ content: string }` |
| `GET` | `/api/cards/:fileId/artifacts/:name` | Artifact | `{ content: string }` |
| `POST` | `/api/cards` | Create a new Build Card | `CardRef` |
| `PUT` | `/api/cards/:fileId/status` | Change card status | `CardMetadata` |
| `GET` | `/api/auth/status` | OAuth connections per email | `{ connections: [...] }` |

### Types

```typescript
interface CardListItem {
  fileId: string; cardId: string; status: CardStatus;
  theme: string; pain_score: number;
  creator_email: string | null;
  repo_url: string | null; pr_url: string | null;
}

interface CardDetail extends CardListItem {
  builder_session_id: string | null; box_task_id: string | null;
  has_artifacts: string[];
}
```

---

## Steps

### Step 1: BoxClient — add listCardsWithMetadata

**Files:** `contracts/box-client.mjs`, `contracts/box-client-mock.mjs`, `box-hub/box-client-real.mjs`, `box-hub/lib/search.mjs`

Add `listCardsWithMetadata()` to the frozen contract. Returns `Promise<{ fileId: string; cardId: string; metadata: CardMetadata }[]>`.

- Contract: add abstract method
- Mock: iterate `_listCardIds()`, read metadata, return without internal `_fileId` field
- Real: use Box search API across status subfolders

**Verify:** `node --test contracts/ tests/`

---

### Step 2: API routes + CORS on orchestrator

**Files:** `orchestrator/api.mjs` (NEW), `orchestrator/server.mjs`, `orchestrator/index.mjs`

**`api.mjs`** — exports route handlers:
- `GET /api/cards` → `box.listCardsWithMetadata()`
- `GET /api/cards/:fileId` → `box.getMetadata(fileId)` + probe for artifacts
- `GET /api/cards/:fileId/spec` → `box.getSpecMarkdown(fileId)`
- `GET /api/cards/:fileId/artifacts/:name` → need `cardId` lookup via `getMetadata`
- `POST /api/cards` → parse body, generate UUID via `crypto.randomUUID()`, build spec.md with YAML frontmatter, call `box.uploadCard({ cardId, specMarkdown, metadata })`
- `PUT /api/cards/:fileId/status` → `box.setMetadata(fileId, { status })`, `box.moveCard(cardId, status)` if terminal
- `GET /api/auth/status` → return token store snapshot (email → login)

**`server.mjs`** — add CORS headers (`Access-Control-Allow-Origin: *`, methods, headers) on all `/api/*` responses. Mount API routes before falling through to 404.

**`index.mjs`** — pass `box`, `tokenStore` to `createWebhookServer` so they reach `api.mjs`.

**Verify:** `curl -v http://localhost:8080/api/cards` sees `Access-Control-Allow-Origin: *` header.

---

### Step 3: Vite React frontend

**Files:** `rantify-ui/` (NEW directory)

Initialize with Vite + React:
```bash
npm create vite@latest rantify-ui -- --template react
```

Then build:

**`src/api.js`** — fetch wrapper:
```js
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';
export async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

**Pages:**
- `Dashboard.jsx` — fetches `GET /api/cards`, groups by `status`, renders 6 `KanbanColumn` components. Each `Card` shows theme, pain_score, creator_email. Click → navigate to `/card/:fileId`
- `CardDetail.jsx` — fetches `GET /api/cards/:fileId` + spec, renders metadata table, spec viewer (monospace), artifact links. Action buttons for status transitions. PR link when available
- `SubmitForm.jsx` — form: theme, pain description, signal_strength (slider), creator_email. Builds YAML frontmatter + spec.md body, calls `POST /api/cards`
- `OAuthStatus.jsx` — fetches `GET /api/auth/status`, shows connected emails with GitHub login, OAuth login button

**Routing:** `react-router-dom` — `/` → Dashboard, `/card/:fileId` → CardDetail, `/submit` → SubmitForm, `/oauth` → OAuthStatus

**`vercel.json`:**
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**`vite.config.js`** — no proxy needed (calls direct to backend with CORS). Set `VITE_API_URL` in Vercel env vars to the deployed orchestrator URL.

**Verify:** `npm run dev` → dashboard loads. Create a card → appears on dashboard.

---

### Step 4: Polish

**Files:** `rantify-ui/src/` (updates)

- Loading spinners, error toasts, empty states
- Responsive CSS (works on mobile)
- Dark/light mode toggle
- Spec viewer with YAML syntax highlighting (simple regex-based, no extra deps)
- Status color coding
- Page transition animations

**Verify:** Full walkthrough: dashboard → card detail → submit → status change → OAuth connect.

---

## Dependency Graph

```
Step 1 (listCardsWithMetadata)
  └──→ Step 2 (API + CORS)
         └──→ Step 3 (React app)
                └──→ Step 4 (polish)
```

All serial — each step depends on the previous.

---

## Anti-patterns to Avoid

1. **Don't proxy through Vite dev server** — the frontend calls the backend directly via CORS. Use `VITE_API_URL` env var pointing to the running orchestrator.
2. **Don't mutate existing BoxClient signatures** — add new methods; never change existing ones.
3. **Don't put business logic in the frontend** — the React app is a view layer only. All mutations go through the API.
4. **Don't add auth to the dashboard** — same trust model as the webhook. The API is unprotected.
5. **Don't commit `.env`** — only `.env.example` with `VITE_API_URL=http://localhost:8080`.
