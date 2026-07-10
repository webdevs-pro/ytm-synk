export interface SavedPlaylistMeta {
  id: string
  title: string
  count: number
  thumbnails: Array<{ url: string; width: number; height: number }>
}

export interface AppConfig {
  musicRoot: string
  selectedPlaylists: string[]
  manualPlaylists: SavedPlaylistMeta[]
  downloadFormat: 'mp3'
  downloadQuality: string
  logRetentionDays: number
}

export interface LocalTrack {
  videoId: string
  title: string
  artists: string[]
  durationSec: number | null
  fileName: string
  filePath: string
  downloadedAt: string
}

export interface PlaylistIndex {
  id: string
  name: string
  lastSyncedAt: string | null
  folder: string
  tracks: Record<string, LocalTrack>
}

export interface PlaylistSummary {
  id: string
  title: string
  count: number
  thumbnails: Array<{ url: string; width: number; height: number }>
  selected: boolean
  lastSyncedAt: string | null
}

export interface RemoteTrack {
  videoId: string
  title: string
  artists: string[]
  durationSec: number | null
  thumbnailUrl: string | null
}

export type SyncLogLevel = 'info' | 'success' | 'warning' | 'error'

export interface SyncLogEntry {
  level: SyncLogLevel
  message: string
  timestamp: string
  playlistId?: string
  videoId?: string
}

export interface SyncProgress {
  playlistId: string
  playlistName: string
  phase: 'fetching' | 'deleting' | 'downloading' | 'done' | 'error'
  current: number
  total: number
  currentTrack?: string
}

export interface SyncSummary {
  downloaded: number
  deleted: number
  skipped: number
  errors: number
  playlists: number
}

export interface AuthStatus {
  isAuthenticated: boolean
  accountName: string | null
}

export interface DownloaderInfo {
  ytdlpPath: string
  ffmpegPath: string
  ytdlpExists: boolean
  ffmpegExists: boolean
  jsRuntimeKind: 'deno' | 'node' | null
  jsRuntimeExists: boolean
}

export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'unavailable'
  | 'error'

export interface AppUpdateStatus {
  state: AppUpdateState
  currentVersion: string
  availableVersion?: string
  percent?: number
  packaged: boolean
  message?: string
}
