# Design

## System Overview

Love Book uses a restrained private-diary product interface. The UI is light by default with a dark system preference mode, neutral surfaces, clear borders, compact shadows, and rose accents reserved for primary actions, selected states, and meaningful emotional markers.

## Color

- `ink`: primary readable text.
- `ink-soft` and `ink-muted`: secondary labels, helper copy, and metadata.
- `cream` and `cream-deep`: page background and quiet neutral layers.
- `surface` and `surface-raised`: app panels, forms, cards, sheets, and headers.
- `line`: borders and separators.
- `rose` and `rose-deep`: primary actions, current selection, active state, and important relationship markers.
- `sage`, `peach`, and semantic Tailwind colors: limited supporting states such as cycle phases, success, warnings, and filters.

Avoid gradient text, decorative glassmorphism, heavy shadows, and large tinted background effects.

## Typography

The interface uses Inter plus Noto Sans SC through `next/font`. `font-display`, `font-body`, and `font-sc` all resolve to a restrained sans-serif stack so headings, labels, data, and controls feel consistent. Headings use weight and spacing rather than decorative display fonts.

## Components

- `glass-card` is now a restrained raised panel: high-readability surface, hairline border, and compact shadow.
- `btn-primary` is a solid rose action button with hover, active, disabled, and focus states.
- `btn-ghost` is a bordered neutral button for secondary actions.
- `.input-field` is a full-width tokenized input with visible focus, readable placeholders, and mobile-safe tap sizing.
- Shared `Button`, `Card`, `Badge`, `Sheet`, and `TimelineHeader` components provide the baseline vocabulary for app and admin pages.

## Layout And Motion

Pages use centered content widths appropriate to the workflow: narrower reading and writing surfaces, wider todo/admin/dashboard surfaces. Motion stays under short product-feedback timings and is covered by the global `prefers-reduced-motion` rule. 3D and lottery animations remain feature-specific, not decorative page chrome.
