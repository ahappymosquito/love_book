# Changelog

Love Book follows Semantic Versioning. Git tags are the source of truth for released versions; changes without a matching tag remain unreleased.

## [Unreleased]

### Added

- Nothing yet.

### Fixed

- Nothing yet.

### Database

- No pending schema changes.

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

[Unreleased]: https://github.com/ahappymosquito/love_book/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ahappymosquito/love_book/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ahappymosquito/love_book/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/ahappymosquito/love_book/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ahappymosquito/love_book/compare/v0.2.3...v0.4.0
[0.2.3]: https://github.com/ahappymosquito/love_book/releases/tag/v0.2.3
