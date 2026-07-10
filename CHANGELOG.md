# Changelog

All notable changes to YTM-Synk are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3] - 2026-07-10

### Fixed

- Library playlists load more reliably (auth headers/cookies aligned with music.youtube.com)
- Playlist IDs normalized so `VL…` and bare IDs match for selection and sync state
- When library browse fails or returns a signed-out page, show a clear error and still list saved/manual playlists

### Changed

- Select controls styled to match other form inputs

## [1.2.2] - 2026-07-10

### Added

- "Checking for updates" toast while yt-dlp update is in progress

### Fixed

- Update yt-dlp button no longer stays disabled if the update fails

## [1.2.1] - 2026-07-10

### Fixed

- Updating yt-dlp no longer launches a second app window
- Prevent duplicate app instances (single-instance lock; focus existing window)

### Changed

- After yt-dlp update, show a restart toast with a Restart action

## [1.2.0] - 2026-07-10

### Added

- Toast notifications for sync results, playlist actions, auth, settings, and app updates
- Download confirmation for app updates (check only on start / button; download after confirm)
- Restart action on the "update ready" toast to install downloaded updates

### Changed

- Settings feedback now uses toasts instead of inline status messages

## [1.1.3] - 2026-07-10

### Fixed

- Release workflow reliability when publishing Windows installers to GitHub Releases

## [1.1.2] - 2026-07-10

### Changed

- Maintenance release for packaging and release pipeline updates

## [1.1.1] - 2026-07-10

### Added

- In-app auto-updater with check, download, and install from Settings

## [1.1.0] - 2026-07-10

### Added

- Initial public release: playlist sync, auth, settings, and Windows installer
