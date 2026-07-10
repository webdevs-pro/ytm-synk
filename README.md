# YTM-Synk

**YouTube Music synchronizer** — a Windows desktop app that mirrors YouTube Music playlists into local MP3 folders.

Built with Electron, React, TypeScript, `ytmusic-api`, `yt-dlp`, and `ffmpeg`.

## Features

- **Sign in** via in-app browser, or import a browser `cookies.txt`
- **Add playlists manually** by URL or ID (`PLxxx…`, `LM` for Liked Music) when library browse is empty
- **Per-playlist Sync** or sync all selected playlists at once
- **Mirror sync**: download new tracks, skip files already on disk, delete tracks removed from the playlist
- **Per-playlist folders** under your music root
- **Download quality** options (best available, or 128–320 kbps)
- **Windows taskbar progress** while syncing
- **Sync logs** on disk with configurable retention (default 10 days)
- Bundled **yt-dlp**, **ffmpeg**, and a JS runtime for yt-dlp

## Requirements

- Windows 10/11
- Node.js 20+ (for development)
- A YouTube Music account

## Development

```bash
npm install
npm run download-binaries   # if binaries are missing
npm run dev
```

If Electron install scripts were blocked:

```bash
node node_modules/electron/install.js
npm run download-binaries
npm run dev
```

Useful scripts:

| Command | Description |
| --- | --- |
| `npm run dev` | Run in development |
| `npm run typecheck` | TypeScript checks |
| `npm run build:win` | Build Windows installer |
| `npm run download-binaries` | Fetch yt-dlp / ffmpeg / Deno |

## Build (Windows)

```bash
npm run build:win
```

Output is written to `release/`.

## Usage

1. Open **Settings** and choose your music folder.
2. Sign in to YouTube Music (or import `cookies.txt`).
3. Open **Playlists**:
   - Add a playlist by URL/ID if needed
   - Check playlists to include in bulk sync
   - Use **Sync** on a row to sync only that playlist
   - Use **Remove** to drop a playlist (optional: delete its local folder)
4. Open **Sync** and click **Sync now** to sync all selected playlists.

Local layout:

```text
<musicRoot>/<Playlist Name>/Artist - Title [videoId].mp3
```

App data (config, auth, indexes, logs):

```text
%APPDATA%\ytm-synk\
  config.json
  auth.json
  cookies.txt
  playlists\
  logs\
```

## How sync works

For each playlist:

1. Fetch the full track list from YouTube Music (paginated)
2. Scan the local folder and adopt existing MP3s by video ID
3. Delete files that are no longer in the playlist
4. Download missing tracks with yt-dlp → MP3 + tags/cover art
5. Update the JSON index and write a sync log file

## Settings

- Music folder
- YouTube Music sign-in / cookies import
- Download quality
- Log retention (days) and open logs folder
- Update bundled yt-dlp

## Personal use

This app uses unofficial YouTube Music APIs and `yt-dlp`. Use it only for personal backups of content you have the right to access. Respect YouTube/Google terms of service.
