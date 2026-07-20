# Changelog

Love Book follows Semantic Versioning. Git tags are the source of truth for released versions; changes without a matching tag remain unreleased.

## [Unreleased]

### Added

- Nothing yet.

### Fixed

- Nothing yet.

### Database

- No pending schema changes.

## [0.3.0] - 2026-07-20

### Added

- Added the private Love Receipt flow, including delivery progress, photos, honest positive or negative moods, and optional one-to-five-star ratings.
- Added a single root application version, automated manifest checks, locked backend dependencies, and immutable release images.

### Changed

- Replaced the Timeline receipt envelope with a gift icon and kept logout only in Settings.
- Production deployment now pins matching frontend and backend image versions instead of `latest`.

### Database

- Added Love Receipt tables, private media metadata, expanded receipt moods, and the nullable `receipt_rating` column through forward-compatible startup migrations.

## [0.2.3] - 2026-07-18

### Fixed

- Kept Love Receipt table creation and list ordering compatible with MySQL and MariaDB.

[Unreleased]: https://github.com/ahappymosquito/love_book/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ahappymosquito/love_book/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/ahappymosquito/love_book/releases/tag/v0.2.3
