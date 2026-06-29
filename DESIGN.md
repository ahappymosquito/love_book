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
- Shared `Button`, `Card`, `Badge`, `Sheet`, `AppHeader`, and authenticated `BottomNav` components provide the baseline vocabulary for app and admin pages. `AppHeader` is the unified sticky top bar for `/timeline`, `/cycle`, `/todo`, and `/habits`, with the user avatar linking to `/me`, a consistent title/subtitle area, page action slot, logout control, safe-area spacing, and shared max width.
- `BottomNav` uses an app-style five-slot structure with a restrained iOS liquid-glass shell and a shared glass selection lens that slides between ordinary destinations. Its center Create action is a compact rose pill with a heavy white plus. Activating Create gathers the shared lens into the center action before a near-full-height create sheet rises from the bottom; reduced-motion mode opens the sheet without travel. Direct `/create` visits retain a standalone page using the same shared form. The final slot now opens `/habits`; settings stay available from the top avatar.
- Login uses a full-screen puppy background with an offset foreground panel rather than a centered poster layout. Mobile keeps the form low and thumb-friendly without centering it, desktop pushes the panel away from the puppy's face, and the copy stays minimal: welcome, token, enter, admin. The puppy scene supports `hero` and `inline` variants, touch-safe click feedback, biased camera framing for the login surface, and reduced-motion soft/still fallbacks instead of one fixed desktop composition.
- Timeline home keeps the "我们的甜蜜小事" header visually clean; Todo and cycle shortcuts live in the authenticated bottom navigation rather than as title-side icon buttons.
- Timeline home starts with one compact relationship quote band that combines the pair names, relationship day count, current quote, and anniversary or festival reminder pills. It does not duplicate bottom navigation destinations such as create, cycle, or habits in the top section, and it does not expose quote-source implementation labels. Event lists reduce card nesting on mobile so scanning and tapping feel closer to a message timeline than a stack of heavy tiles. Visible page copy must speak from the user's point of view and must not describe implementation changes, layout optimizations, or release-note style updates.
- `/todo` uses a Microsoft To Do style task workspace adapted to Love Book: a left list rail on desktop, a warm central task list, and a right-side detail panel; mobile collapses the rail and opens task detail as a bottom sheet. The default list shows all unfinished todos, sorts dated items before undated items by due date, and keeps completed check-ins in a folded section below the active list. Dates are set inside detail only, completion requires both partners to comment, location-aware AMap candidates show compact distance/address/rating metadata, weather hints use a quiet peach panel only when a scheduled place has forecast data, comments show authors, and photos live in a folded grid. The structure can feel familiar and task-focused, but the color, spacing, and state language stay rose, peach, sage, readable, and soft.
- `/habits` is a daily check-in dashboard with a higher-end liquid-glass treatment: the calendar supports Monday-start week view by default plus an optional month view, and each date cell shows both partners' completion with each partner owning half the cell and each active habit taking an equal segment. The lower panels are full-width vertical accordions on every viewport, with the current user's panel open by default and the counterpart panel read-only. Habit colors use one left-side color button in the creation row, opening a liquid palette with default rose, bright presets, and custom color; color choices also appear during explicit editing rather than on every row. Completed rows become sage green glass surfaces with a short check animation, and full pair completion may use a brief fused-color celebration that respects reduced motion.
- `/me` is a compact settings surface: the main profile card shows avatar, nickname, email, and relationship days in view mode first; clicking nickname/email switches to inline editing. The location card sits as a functional settings panel with a map-pin signal, current-location action, manual address/city inputs, and clear action without modal friction. User quotes, default quotes, loading, and empty states share equal-width readable bordered row styling, with default quotes shown directly below user quotes.

## Layout And Motion

Pages use centered content widths appropriate to the workflow: narrower reading and writing surfaces, wider todo/admin/dashboard surfaces. Authenticated user pages reserve bottom safe-area space for the fixed bottom navigation, with the event composer positioned above it. Timeline home and login now share explicit mobile-safe spacing rules so the bottom nav, cycle reminder, and create sheet do not collide. Motion is smooth and gentle for hover, click, open, save, 3D login, animated create, and lottery moments, and remains covered by the global `prefers-reduced-motion` rule.
