# HeroUI Dark Dashboard Design

## Goal

Refactor the EMKE Design Review interface to match the HeroUI dashboard reference and the provided HeroUI theme tokens. The product should remain a focused internal review command center, not a marketing page.

## Visual Direction

- Default to dark mode using `document.documentElement.classList.add("dark")` and `data-theme="dark"`.
- Use the provided HeroUI token set as the source of truth for light and dark variables.
- Primary app look: black shell, deep neutral surfaces, rounded dark cards, pill navigation, circular icon actions, and bright cyan-blue accent controls.
- Keep purple/cyan gradient use minimal, mainly for avatars or subtle brand marks. Do not convert the app to a light dashboard.

## Layout

- Preserve the existing React/Vite single-page architecture and current API contracts.
- Keep the left sidebar, but restyle it like the reference: profile block at the top, large pill nav items, settings/user controls at the bottom.
- Dashboard should read like a compact operations dashboard: greeting/header actions, segmented task views, metric cards, filter/search controls, and review queues.
- Detail pages should keep the preview-first workflow, with dark rounded panels and a compact issue sidebar.

## Components

- Update `src/styles.css` as the primary implementation surface.
- Make small JSX changes in `src/main.tsx` only where structure or copy is needed for the dashboard language.
- Use existing HeroUI imports and lucide icons already present in the project.
- Preserve all current workflows: access, create review, frame selection, AI review detail, VIS source, and settings.

## Verification

- Run `npm run build`.
- Check the app in the in-app browser at desktop width and a mobile-sized viewport.
- Confirm text fits, no panels overlap, and the visual style follows the provided dark HeroUI tokens.
