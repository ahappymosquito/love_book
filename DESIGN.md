# Design

## System Overview

Love Book uses a soft couple-scrapbook product interface. The UI is light by default with a warm night mode, muted rose and peach warmth, sage positive states, creamy readable surfaces, and rounded controls that feel cute without causing visual fatigue.

## Color

- `ink`: primary readable text.
- `ink-soft` and `ink-muted`: secondary labels, helper copy, and metadata.
- `cream` and `cream-deep`: warm scrapbook background and tinted neutral layers.
- `surface` and `surface-raised`: bright panels, forms, cards, sheets, and headers.
- `line`: borders and separators.
- `rose` and `rose-deep`: soft primary actions, current selection, message ownership, and important relationship markers.
- `peach` and `peach-deep`: warm emphasis, schedule highlights, and gentle section accents.
- `sage`: comfortable completion, calm positive states, and check-in success.

Use low-saturation washes and full-card tints intentionally. Avoid harsh saturated fields, gradient text, decorative glassmorphism, generic purple-blue gradients, and low-contrast pastel text.

## Typography

The interface uses Inter plus Noto Sans SC through `next/font`. `font-display`, `font-body`, and `font-sc` resolve to a friendly sans-serif stack. Headings use confident weight and comfortable spacing, while labels and data stay compact and readable.

## Components

- `glass-card` is a soft scrapbook panel: readable surface, warm border, low-contrast color shadow, and no blur dependency.
- `btn-primary` is a muted rose-to-peach action button with hover, active, disabled, and focus states.
- `btn-ghost` is a warm secondary button with calm hover feedback.
- `.input-field` is a full-width rounded input with visible berry focus, readable placeholders, and mobile-safe tap sizing.
- Shared `Button`, `Card`, `Badge`, `Sheet`, `TimelineHeader`, and authenticated `BottomNav` components provide the baseline vocabulary for app and admin pages.
- `BottomNav` uses an app-style five-slot structure with a restrained iOS liquid-glass shell and a shared glass selection lens that slides between ordinary destinations. Its center Create action is a compact rose pill with a heavy white plus. Activating Create gathers the shared lens into the center action before a near-full-height create sheet rises from the bottom; reduced-motion mode opens the sheet without travel. Direct `/create` visits retain a standalone page using the same shared form.
- Timeline home keeps the "我们的甜蜜小事" header visually clean; Todo and cycle shortcuts live in the authenticated bottom navigation rather than as title-side icon buttons.
- `/me` is a compact settings surface: the main profile card shows avatar, nickname, email, and relationship days in view mode first; clicking nickname/email switches to inline editing. User quotes, default quotes, loading, and empty states share equal-width readable bordered row styling, with default quotes shown directly below user quotes.

## Layout And Motion

Pages use centered content widths appropriate to the workflow: narrower reading and writing surfaces, wider todo/admin/dashboard surfaces. Authenticated user pages reserve bottom safe-area space for the fixed bottom navigation, with the event composer positioned above it. Motion is smooth and gentle for hover, click, open, save, 3D login, animated create, and lottery moments, and remains covered by the global `prefers-reduced-motion` rule.
