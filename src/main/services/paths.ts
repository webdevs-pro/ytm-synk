import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export function getUserDataPath(): string {
  return app.getPath('userData')
}

export function getConfigPath(): string {
  return join(getUserDataPath(), 'config.json')
}

export function getPlaylistsIndexDir(): string {
  return join(getUserDataPath(), 'playlists')
}

export function getCookiesPath(): string {
  return join(getUserDataPath(), 'cookies.txt')
}

export function getEncryptedCookiesPath(): string {
  return join(getUserDataPath(), 'cookies.enc')
}

export function getAuthJsonPath(): string {
  return join(getUserDataPath(), 'auth.json')
}

export function getLogsDir(): string {
  return join(getUserDataPath(), 'logs')
}

export function getBackupsDir(): string {
  return join(getUserDataPath(), 'backups')
}

export function getProjectRoot(): string {
  return app.getAppPath()
}

export function getDevBinDir(): string {
  return join(getProjectRoot(), 'bin')
}

export function getBundledBinDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin')
  }
  return getDevBinDir()
}

export function getYtDlpPath(): string {
  const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  return join(getBundledBinDir(), name)
}

export function getFfmpegPath(): string {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const bundled = join(getBundledBinDir(), name)
  if (existsSync(bundled)) return bundled

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static') as string | null
    if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic
  } catch {
    // ffmpeg-static may not be installed during build
  }

  return bundled
}

export function sanitizeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim() || 'Playlist'
}

export function getPlaylistFolder(musicRoot: string, playlistName: string): string {
  return join(musicRoot, sanitizeFolderName(playlistName))
}
