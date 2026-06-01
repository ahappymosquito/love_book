# Design

## System Overview

Love Book uses a lively couple-scrapbook product interface. The UI is light by default with a warm night mode, berry and orange energy, mint positive states, creamy readable surfaces, and rounded controls that feel cute without hiding standard product affordances.

## Color

- `ink`: primary readable text.
- `ink-soft` and `ink-muted`: secondary labels, helper copy, and metadata.
- `cream` and `cream-deep`: warm scrapbook background and tinted neutral layers.
- `surface` and `surface-raised`: bright panels, forms, cards, sheets, and headers.
- `line`: borders and separators.
- `rose` and `rose-deep`: berry primary actions, current selection, message ownership, and important relationship markers.
- `peach` and `peach-deep`: warm emphasis, schedule highlights, and playful section accents.
- `sage`: mint completion, calm positive states, and check-in success.

Use colorful washes and full-card tints intentionally. Avoid gradient text, decorative glassmorphism, generic purple-blue gradients, and low-contrast pastel text.

## Typography

The interface uses Inter plus Noto Sans SC through `next/font`. `font-display`, `font-body`, and `font-sc` resolve to a friendly sans-serif stack. Headings use bolder weight and cheerful spacing, while labels and data stay compact and readable.

## Components

- `glass-card` is a bright scrapbook panel: readable surface, warm border, soft color shadow, and no blur dependency.
- `btn-primary` is a berry-to-coral action button with hover, active, disabled, and focus states.
- `btn-ghost` is a warm secondary button with visible hover lift.
- `.input-field` is a full-width rounded input with visible berry focus, readable placeholders, and mobile-safe tap sizing.
- Shared `Button`, `Card`, `Badge`, `Sheet`, and `TimelineHeader` components provide the baseline vocabulary for app and admin pages.

## Layout And Motion

Pages use centered content widths appropriate to the workflow: narrower reading and writing surfaces, wider todo/admin/dashboard surfaces. Motion is light and cheerful for hover, click, open, save, 3D login, and lottery moments, and remains covered by the global `prefers-reduced-motion` rule.
