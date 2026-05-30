# Kanban Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag Kanban cards forward through pipeline stages; each successful drop calls `PUT /api/cards/:fileId` which physically moves the Box folder on the backend.

**Architecture:** Native HTML5 drag-and-drop (no new dependencies). A `isForwardMove` helper enforces forward-only transitions. Dashboard holds card state and an `onMove` handler that does optimistic UI update → API call → rollback on failure. A `window.confirm()` dialog gates every drop.

**Tech Stack:** React 19, native DnD events (`draggable`, `onDragStart`, `onDragOver`, `onDrop`), existing `api.js` fetch wrapper, `node:test` for pure-function unit test.

---

### Task 1: Add `isForwardMove` helper to `status.js`

**Files:**
- Modify: `rantify-ui/src/lib/status.js`
- Test: `rantify-ui/src/lib/status.test.mjs` (new)

- [ ] **Step 1: Write the failing test**

Create `rantify-ui/src/lib/status.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isForwardMove } from './status.js';

test('same column is not a forward move', () => {
  assert.equal(isForwardMove('inbox', 'inbox'), false);
});

test('one step forward is allowed', () => {
  assert.equal(isForwardMove('inbox', 'ready-for-build'), true);
});

test('skip-forward is allowed', () => {
  assert.equal(isForwardMove('inbox', 'building'), true);
});

test('backward move is rejected', () => {
  assert.equal(isForwardMove('ready-for-build', 'inbox'), false);
});

test('moving to failed is rejected (orchestrator-only)', () => {
  assert.equal(isForwardMove('inbox', 'failed'), false);
});

test('moving from failed is rejected (terminal)', () => {
  assert.equal(isForwardMove('failed', 'completed'), false);
});

test('moving from completed is rejected (terminal)', () => {
  assert.equal(isForwardMove('completed', 'inbox'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd rantify-ui && node --test src/lib/status.test.mjs
```

Expected: `ReferenceError: isForwardMove is not defined` or import error.

- [ ] **Step 3: Add `isForwardMove` to `status.js`**

Append to the bottom of `rantify-ui/src/lib/status.js`:

```js
// Statuses that can be moved to via drag-and-drop (excludes failed — orchestrator-only)
const DRAGGABLE_STATUSES = ['inbox', 'ready-for-build', 'building', 'building-approved', 'completed'];

/** Returns true only if `to` comes strictly after `from` in the pipeline and is not failed. */
export function isForwardMove(from, to) {
  const fi = DRAGGABLE_STATUSES.indexOf(from);
  const ti = DRAGGABLE_STATUSES.indexOf(to);
  return fi !== -1 && ti !== -1 && ti > fi;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd rantify-ui && node --test src/lib/status.test.mjs
```

Expected: `▶ 7 passing`.

---

### Task 2: Add `moveCard` API helper

**Files:**
- Modify: `rantify-ui/src/api.js`

No test file needed — this is a thin wrapper around `fetch`; the integration is verified in Task 5 via manual browser testing.

- [ ] **Step 1: Add `moveCard` export to `api.js`**

Append to `rantify-ui/src/api.js`:

```js
/** Move a card to a new status. Calls PUT /api/cards/:fileId with { status }. */
export async function moveCard(fileId, status) {
  return api(`/api/cards/${fileId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}
```

- [ ] **Step 2: Verify build still passes**

```bash
cd rantify-ui && npm run build
```

Expected: build succeeds with no errors.

---

### Task 3: Make `Card` draggable

**Files:**
- Modify: `rantify-ui/src/components/Card.jsx`

- [ ] **Step 1: Add drag props to Card**

Replace the `<article>` opening tag block in `Card.jsx`. The full updated file:

```jsx
import { useNavigate } from 'react-router-dom';
import { STATUS_COLOR } from '../lib/status';

export default function Card({ fileId, theme, pain_score, creator_email, status, repo_url, pr_url }) {
  const navigate = useNavigate();
  const color = STATUS_COLOR[status] || 'var(--st-inbox)';
  const pain = pain_score != null ? Math.max(0, Math.min(1, Number(pain_score))) : null;

  function handleDragStart(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ fileId, status, theme: theme || 'Untitled' }));
  }

  return (
    <article
      className="card"
      style={{ '--card-color': color }}
      draggable
      onDragStart={handleDragStart}
      onClick={() => navigate(`/card/${fileId}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/card/${fileId}`)}
    >
      <div className="card-theme">{theme || 'Untitled'}</div>
      <div className="card-meta">
        {pain != null && (
          <span className="card-pain" title={`Pain score: ${pain.toFixed(2)}`}>
            <span className="pain-bar"><span className="pain-fill" style={{ width: `${pain * 100}%` }} /></span>
            {pain.toFixed(2)}
          </span>
        )}
        {creator_email && <span className="card-email" title={creator_email}>{creator_email}</span>}
      </div>
      {(repo_url || pr_url) && (
        <div className="card-links">
          {repo_url && <a href={repo_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>repo ↗</a>}
          {pr_url && <a href={pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>PR ↗</a>}
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd rantify-ui && npm run build
```

Expected: build succeeds with no errors.

---

### Task 4: Make `KanbanColumn` a drop target

**Files:**
- Modify: `rantify-ui/src/components/KanbanColumn.jsx`

- [ ] **Step 1: Rewrite KanbanColumn with drop handling**

Full updated file:

```jsx
import { useState } from 'react';
import Card from './Card';
import { STATUS_LABEL, STATUS_COLOR, isForwardMove } from '../lib/status';

export default function KanbanColumn({ status, cards, onMove }) {
  const [dragOver, setDragOver] = useState(false);
  const color = STATUS_COLOR[status] || 'var(--text-3)';

  function handleDragOver(e) {
    // Parse the dragged card's current status from dataTransfer
    // (can't read data during dragover in all browsers, so we use a data attribute trick)
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    let payload;
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }
    const { fileId, status: fromStatus, theme } = payload;
    if (!isForwardMove(fromStatus, status)) return;
    const label = (s) => STATUS_LABEL[s] || s;
    const confirmed = window.confirm(
      `Move "${theme}" from ${label(fromStatus)} → ${label(status)}?\n\nThis will move the Box folder.`
    );
    if (!confirmed) return;
    onMove(fileId, status, fromStatus);
  }

  return (
    <section
      className={`column${dragOver ? ' column-drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="column-title">
        <span className="label-row">
          <span className="status-dot" style={{ background: color }} />
          {STATUS_LABEL[status] || status}
        </span>
        <span className="count">{cards.length}</span>
      </div>
      <div className="column-cards">
        {cards.map((c) => <Card key={c.fileId} {...c} />)}
        {cards.length === 0 && <p className="empty">Empty</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd rantify-ui && npm run build
```

Expected: build succeeds with no errors.

---

### Task 5: Wire up Dashboard with optimistic update and error rollback

**Files:**
- Modify: `rantify-ui/src/pages/Dashboard.jsx`

- [ ] **Step 1: Rewrite Dashboard with `onMove` handler**

Full updated file:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, moveCard } from '../api';
import KanbanColumn from '../components/KanbanColumn';
import { STATUSES } from '../lib/status';
import { IconArrow } from '../components/icons';

export default function Dashboard() {
  const [cards, setCards] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moveError, setMoveError] = useState(null);

  const load = useCallback(() => {
    api('/api/cards')
      .then((data) => { setCards(data); setError(null); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const handleMove = useCallback((fileId, newStatus, oldStatus) => {
    // Optimistic update
    setCards((prev) => prev.map((c) => c.fileId === fileId ? { ...c, status: newStatus } : c));
    setMoveError(null);

    moveCard(fileId, newStatus).catch((err) => {
      // Rollback on failure
      setCards((prev) => prev.map((c) => c.fileId === fileId ? { ...c, status: oldStatus } : c));
      setMoveError(`Failed to move card: ${err.message}`);
    });
  }, []);

  const grouped = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const c of cards) (grouped[c.status] || (grouped[c.status] = [])).push(c);

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Build loop · live</span>
          <h1 className="display">Pipeline</h1>
          <p>{cards.length} card{cards.length === 1 ? '' : 's'} moving from request to shipped.</p>
        </div>
        <Link to="/submit" className="btn btn-accent">Submit a request <IconArrow className="arrow" /></Link>
      </div>

      {loading && <div className="loading"><span className="pulse" /> Loading cards…</div>}
      {error && <div className="error">Failed to load: {error}</div>}
      {moveError && <div className="error">{moveError}</div>}

      {!loading && !error && (
        <div className="kanban">
          {STATUSES.map((s) => (
            <KanbanColumn key={s} status={s} cards={grouped[s] || []} onMove={handleMove} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd rantify-ui && npm run build
```

Expected: build succeeds with no errors.

---

### Task 6: Add drag-over highlight CSS

**Files:**
- Modify: `rantify-ui/src/index.css`

- [ ] **Step 1: Add `.column-drag-over` styles**

Find the `.column` CSS rule block in `index.css` and add the drag-over variant immediately after it:

```css
.column-drag-over {
  outline: 2px dashed var(--accent);
  outline-offset: -4px;
  background: color-mix(in srgb, var(--accent) 6%, var(--surface-1));
}
```

- [ ] **Step 2: Final build and smoke test**

```bash
cd rantify-ui && npm run build
```

Expected: build succeeds. Then start the dev server and manually verify:

```bash
npm run dev
```

1. Open `http://localhost:5173` and navigate to the Dashboard.
2. Drag a card from `Inbox` — the `Ready` column should show a dashed blue outline on hover.
3. Drop it — confirm dialog appears with the card's theme and status labels.
4. Click **OK** — card moves to `Ready` column immediately (optimistic).
5. Click **Cancel** on another drag — card stays put.
6. Try dragging a card *backward* — drop should silently no-op (no confirm, no move).

---

### Task 7: Run the unit tests one final time

- [ ] **Step 1: Run status unit tests**

```bash
cd rantify-ui && node --test src/lib/status.test.mjs
```

Expected: `▶ 7 passing`
