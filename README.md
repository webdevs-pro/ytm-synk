# YTM-Synk

Windows desktop app that mirrors selected YouTube Music playlists into local per-playlist MP3 folders.

## Features

- Sign in to YouTube Music (in-app browser or cookies.txt import)
- Browse your library playlists and choose which ones to mirror
- Manual sync: download new tracks, delete removed tracks, skip already-synced files
- JSON index stored in app user data
- Bundled `yt-dlp` and `ffmpeg`

## Development

```bash
npm install
npm run dev
```

If install scripts were blocked, approve them and re-run:

```bash
npm install-scripts approve electron ffmpeg-static
npm install
```

## Build (Windows)

```bash
npm run build:win
```

Installer output is written to `release/`.

## Usage

1. Open **Settings** and choose your music root folder.
2. Sign in to YouTube Music or import a `cookies.txt` file.
3. Open **Playlists** and select playlists to mirror.
4. Open **Sync** and click **Sync now**.

Each selected playlist is stored under:

```text
<musicRoot>/<Playlist Name>/*.mp3
```

## Personal use

This app uses unofficial YouTube Music APIs and `yt-dlp`. Use it only for personal backups of content you have the right to access. Respect YouTube/Google terms of service.
