# Changelog

All notable changes to YTM-Synk are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
