# HeroUI Dark Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the EMKE Design Review UI around the provided HeroUI dark dashboard tokens and reference image.

**Architecture:** Keep the existing Vite/React single-page app and backend untouched. Apply the new design mostly through `src/styles.css`, with small markup refinements in `src/main.tsx` for sidebar/header/dashboard affordances.

**Tech Stack:** React 19, Vite, TypeScript, HeroUI React/styles, lucide-react, CSS variables.

---

### Task 1: Theme Tokens And Global Surface

**Files:**
- Modify: `src/styles.css`

- [ ] Replace the current root variables with the provided HeroUI light and dark token blocks.
- [ ] Keep dark mode as the app default.
- [ ] Map legacy variable names such as `--color-electric-blue`, `--color-tangerine`, and `--color-emerald` to the new token values so existing selectors keep working.
- [ ] Update body, inputs, buttons, panels, and scrollbar styling to use token variables instead of hard-coded grays.

### Task 2: App Shell And Sidebar

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

- [ ] Restyle the shell to match the reference: black outer background, rounded app frame feel, deep sidebar, subtle dividers.
- [ ] Rework sidebar visual hierarchy with profile-style user block, pill nav items, active item background, and cyan brand mark.
- [ ] Keep navigation behavior unchanged.

### Task 3: Dashboard

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

- [ ] Restyle dashboard header as a dark operations header with compact actions.
- [ ] Convert metrics to rounded dark HeroUI cards.
- [ ] Add a visual segmented control treatment for queue sections without changing task filtering logic.
- [ ] Restyle task cards, filter bar, chips, status badges, empty states, and queue board.

### Task 4: Workflow Pages

**Files:**
- Modify: `src/styles.css`

- [ ] Restyle Access, New Task, Frame Selection, Review Detail, VIS Source, and Settings with the same token system.
- [ ] Keep the review detail preview area dominant, but make the toolbar, score card, issue filters, and issue cards match the new dashboard cards.
- [ ] Ensure destructive actions remain visually distinct through `--danger`.

### Task 5: Verification

**Files:**
- No source edits unless verification reveals a bug.

- [ ] Run `npm run build`.
- [ ] Start or reuse the local dev server.
- [ ] Verify the app visually in the in-app browser at `http://localhost:5173/`.
- [ ] Check responsive behavior below 980px.
