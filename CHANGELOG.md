# Changelog

Love Book follows Semantic Versioning. Git tags are the source of truth for released versions; changes without a matching tag remain unreleased.

## [Unreleased]

## [0.9.1] - 2026-08-22

### Added

- Added `LOVE_BOOK_SSH_HOSTS` and `scripts/deploy_host.py` so agents can package locally, then check or publish through named `~/.ssh/config` hosts such as `ts3_qrqto` and `root_qrqto`.
- Added host Nginx vhosts, certbot webroot renewal, and a Caddy-to-Nginx cutover that keeps `cdn.qrqto.club` on the existing static root.

### Changed

- Replaced the atlas-based login runner with a fully code-drawn 花田拾光: geometric Xiaohua, hashed meadow scenery, and shape obstacles, plus a start menu. Visitors with a stored or URL token skip the game and enter the app; play starts only from the menu.
- Rebuilt the login runner into 花田拾光: chaptered day-to-night meadow, collectible petals and letters, combo scoring, two hearts with invincibility, hold-to-jump-higher on desktop, a double jump after noon, and Space/Up jumping without activating focused runner buttons.
- Removed unused production deploy, backup, and one-off migration scripts from the repository. Local development keeps `start_dev.bat` plus version helpers.
- Replaced production-specific host, account, and mailbox defaults in example env and docs with placeholders.
- Production public HTTP(S) now uses host Nginx instead of the Love Book Caddy container, so other host sites can share 80/443.

## [0.9.0] - 2026-08-05

### Added

- Added a public pixel-grassland Xiaohua runner with a global Top 3 leaderboard and record-name flow on the login page.
- Added unique normalized login names, Argon2id security passwords, 90-day password sessions, and in-session password reset controls.

### Fixed

- Fixed password-session rotation so resetting a credential revokes only password-issued sessions while entry and email-link tokens remain valid.
- Fixed the runner start control being blocked by the default-open login overlay and made every foreground panel pause gameplay reliably.
- Fixed mobile controls to use left-side held crouch and right-side tap jump while retaining desktop mouse and keyboard controls.
- Fixed padded obstacle atlases making visible sprites appear smaller than their collision areas.

### Changed

- Replaced the login-only 3D scene with a responsive Canvas 2D runner and removed animated puppies from Timeline quotes and empty states.
- Expanded the runner to the full viewport, added neutral collapsed login controls, and improved obstacle silhouettes with alpha-bound cropping, pixel outlines, and contact shadows.
- Redesigned the Timeline quote as a quieter single-column content surface with more readable type and spacing.

### Database

- Added nullable user credential fields, device-token source tracking, and the global `game_scores` leaderboard table through startup-compatible schema migration.

## [0.8.0] - 2026-07-31

### Added

- Added a lightweight animated 2D puppy companion to the Timeline, with idle, greeting, curious, and celebration actions.

### Fixed

- Fixed meeting-session regression tests to use the application's `Asia/Shanghai` date instead of the CI runner's local date at UTC day boundaries.
- Fixed production updates silently retaining an older version-pinned Compose image after newer stable images were published.
- Fixed `sudo` updates resolving the deployment and backup paths under `/root` instead of the installed `/home/ts3` paths.

### Changed

- Replaced the Timeline's login-scene dependency with a dedicated transparent puppy atlas, including reduced-motion and background-tab pause behavior for smooth low-overhead animation.
- Stable releases now promote matching frontend and backend images to `latest`, with a reusable production updater that checks versions, creates a validated backup, pulls, starts, and verifies the site.

### Database

- No schema changes.

## [0.7.0] - 2026-07-28

### Changed

- Simplified received-gift timeline cards to make their photo-led presentation more focused and easier to scan.

### Database

- No schema changes.

## [0.6.0] - 2026-07-28

### Added

- Added direct received-gift events with optional feedback, ratings, and up to six private photos in place of the retired delivery workflow.
- Added up to three honest positive or complex feeling tags to received-gift events, independent from written feedback.
- Added photo-led received-gift cards, private timeline previews, responsive detail galleries, and an auditable legacy media migration command.

### Changed

- Moved every legacy love receipt into the shared timeline while preserving its receiver, date, feedback, sender message, meeting relationship, and rating.
- Retired legacy receipt mutations and redirected old receipt pages to their corresponding timeline events.

### Fixed

- Preserved legacy love-receipt image order and made interrupted media copies safe to retry with deterministic paths.

### Database

- Added `gift_received` events, nullable `events.gift_rating` and `events.gift_feelings`, ordered `images.sort_order`, and idempotent legacy image mappings through forward-compatible startup migration.

## [0.5.0] - 2026-07-27

### Added

- Added a validated production backup and recovery workflow covering MySQL, media, environment configuration, Windows retrieval, integrity checks, and quarterly restore drills.

### Changed

- Reorganized development, deployment, API, product, design, and audit documentation under `docs/`.
- Rewrote the root README as a human-oriented product, setup, documentation, and release-history entry point.
- Removed obsolete empty notes and regenerated local test, build, log, and QA artifacts from the working directory.

### Fixed

- Made the production backup script discover the backend container through Docker Compose labels instead of relying on a fixed project-generated container name.

### Database

- No schema changes.

## [0.4.1] - 2026-07-20

### Fixed

- Made clean-checkout CI test temporary directories self-contained so release gates do not depend on a pre-existing ignored parent directory.

### Database

- No schema changes.

## [0.4.0] - 2026-07-20

### Added

- Added the private Love Receipt flow, including delivery progress, photos, honest positive or negative moods, and optional one-to-five-star ratings.
- Added a single root application version, automated manifest checks, locked backend dependencies, and immutable release images.

### Changed

- Replaced the Timeline receipt envelope with a gift icon and kept logout only in Settings.
- Production deployment now pins matching frontend and backend image versions instead of `latest`.

### Fixed

- Isolated locked backend dependencies in a container virtual environment and included the runtime HTTP client required by admin routes.

### Database

- Added Love Receipt tables, private media metadata, expanded receipt moods, and the nullable `receipt_rating` column through forward-compatible startup migrations.

## [0.2.3] - 2026-07-18

### Fixed

- Kept Love Receipt table creation and list ordering compatible with MySQL and MariaDB.

[Unreleased]: https://github.com/ahappymosquito/love_book/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/ahappymosquito/love_book/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ahappymosquito/love_book/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ahappymosquito/love_book/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ahappymosquito/love_book/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/ahappymosquito/love_book/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ahappymosquito/love_book/compare/v0.2.3...v0.4.0
[0.2.3]: https://github.com/ahappymosquito/love_book/releases/tag/v0.2.3
