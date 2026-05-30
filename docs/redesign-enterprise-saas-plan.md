# Rantify — Enterprise SaaS Redesign Plan

**Date:** 2026-05-30
**Goal:** Use the Stitch MCP to make the Rantify UI feel like a professional, easy-to-use,
enterprise-level application by updating the UI/UX.

---

## Decisions (confirmed with user)

| Question | Decision |
|---|---|
| **Direction** | Pivot to a **clean SaaS** aesthetic (Linear / Stripe / Vercel spirit) — drop the warm-paper editorial look, keep the Rantify brand blue + logo. |
| **Scope** | **Everything** — marketing site (Landing, Features, Pricing) **and** product app (Dashboard, Kanban, Card detail, Submit, Integrations). |
| **Stitch workflow** | **Reference designs → code.** Generate polished mockups + a design system in Stitch, then translate them into the React/CSS codebase. |
| **Typography** | **Geist** (headline + body) — modern, technical, developer-native grotesk. |
| **App navigation** | **Left sidebar** + topbar (conventional enterprise layout), replacing the current horizontal top nav. |

---

## Design language: warm editorial → clean SaaS

| Token | Now | New |
|---|---|---|
| Canvas | Cream `#F7F3EA` + paper grain | White `#FFFFFF` / cool slate `#F8FAFC` |
| Surfaces | Warm card + heavy shadows | White cards, hairline `#E2E8F0` borders, soft shadows |
| Ink | Warm brown `#1B1714` | Slate `#0F172A` / `#475569` secondary |
| Accent | Brand blue `#1F52AE` | **Keep** `#1F52AE` (crisper on neutral ground) |
| Headlines | Fraunces serif italic | **Geist** grotesk, tight tracking |
| Radius | 14px, pill buttons | 8px, restrained |
| Density | Generous editorial | Tighter spacing, more compact |

**Structural changes**
- **Product app:** left sidebar nav (Dashboard / Submit / Integrations) + topbar (logo, search, status, "New rant").
- **Kanban:** denser, cleaner columns; crisp status chips; thin colored top border per column.
- **Marketing:** same structure, reskinned — neutral canvas, grotesk type, refined logo wall, cleaner stat band + pricing cards.

---

## Task list

| # | Task | Status |
|---|---|---|
| 1 | **Create Stitch project + Enterprise design system** — brand blue `#1F52AE` seed, Geist headline/body, 8px roundness, light mode, neutral SaaS palette. | ⛔ paused (project creation rejected) |
| 2 | **Generate reference screens in Stitch** — Landing, Dashboard (Kanban), Card detail, Submit form, Integrations, Pricing, using the design system. | ⬜ pending |
| 3 | **Rewrite `index.css` design tokens + components** — neutral SaaS palette, Geist fonts, 8px radii, tighter density, restyled cards/kanban/buttons/forms. | ⬜ pending |
| 4 | **Convert `AppLayout` to left sidebar** — replace top-nav product shell with sidebar + topbar; update related CSS. | ⬜ pending |
| 5 | **Reskin marketing + remaining pages and verify build** — update fonts in `index.html`, adjust marketing components/pages, run the build to verify no breakage. | ⬜ pending |

---

## Planned execution order

1. **Stitch setup (Tasks 1–2)** — create the project, define the "Rantify Enterprise"
   design system (blue seed, Geist, 8px, light mode), then generate the reference
   screens one at a time (each generation takes a few minutes).
2. **CSS rewrite (Task 3)** — translate the Stitch reference designs into
   `rantify-ui/src/index.css`: swap the `:root` tokens (palette, fonts, radius, shadows),
   then restyle buttons, cards, kanban, forms, nav, and marketing sections to match.
   Routes and component logic stay intact — this is primarily a re-skin.
3. **App shell (Task 4)** — rework `rantify-ui/src/components/AppLayout.jsx` into a
   left sidebar + topbar shell and add the supporting CSS.
4. **Marketing + pages (Task 5)** — load Geist in `index.html`, adjust the marketing
   components/pages (`Landing`, `Features`, `Pricing`, `Footer`, `MarketingLayout`,
   `Pipeline`) and product pages (`Dashboard`, `CardDetail`, `SubmitForm`, `OAuthStatus`)
   for the clean look.
5. **Verify** — run `npm run build` (and a dev preview) to confirm nothing is broken.

## Affected files (no logic changes, re-skin only)

- `rantify-ui/index.html` — Geist font links + meta
- `rantify-ui/src/index.css` — full design-token + component rewrite
- `rantify-ui/src/components/AppLayout.jsx` — sidebar shell
- `rantify-ui/src/components/MarketingLayout.jsx`, `Footer.jsx`, `Pipeline.jsx`
- `rantify-ui/src/components/Card.jsx`, `KanbanColumn.jsx`
- `rantify-ui/src/pages/Landing.jsx`, `Features.jsx`, `Pricing.jsx`
- `rantify-ui/src/pages/Dashboard.jsx`, `CardDetail.jsx`, `SubmitForm.jsx`, `OAuthStatus.jsx`

## Constraints / notes

- **No commits** until the full redesign is complete (per saved preference).
- Keep all existing routes, props, and API/component logic unchanged — visual layer only.
- Preserve the Rantify brand: blue `#1F52AE` accent + existing logo asset.
- Stitch generations are slow (minutes each) and token-intensive — generate sequentially.
