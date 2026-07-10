import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig, AppUpdateStatus, AuthStatus, DownloaderInfo, PlaylistSummary, SyncLogEntry, SyncProgress, SyncSummary } from '../shared/types'

export interface YtmApi {
  auth: {
    status: () => Promise<AuthStatus>
    login: () => Promise<{ success: boolean; accountName: string | null; error?: string }>
    logout: () => Promise<{ success: boolean }>
    importCookies: (filePath: string) => Promise<{
      success: boolean
      accountName: string | null
      error?: string
    }>
  }
  playlists: {
    list: () => Promise<PlaylistSummary[]>
    toggle: (playlistId: string, selected: boolean) => Promise<AppConfig>
    add: (input: string) => Promise<PlaylistSummary>
    remove: (playlistId: string, deleteFolder: boolean) => Promise<{ success: boolean }>
    sync: (playlistId: string) => Promise<SyncSummary>
  }
  sync: {
    run: () => Promise<SyncSummary>
    onProgress: (callback: (progress: SyncProgress) => void) => () => void
    onLog: (callback: (entry: SyncLogEntry) => void) => () => void
    onDone: (callback: (summary: SyncSummary) => void) => () => void
  }
  settings: {
    get: () => Promise<AppConfig>
    set: (partial: Partial<AppConfig>) => Promise<AppConfig>
    pickMusicRoot: () => Promise<string | null>
    pickCookiesFile: () => Promise<string | null>
    openLogs: () => Promise<void>
  }
  downloader: {
    info: () => Promise<DownloaderInfo & { version: string | null }>
    update: () => Promise<DownloaderInfo & { version: string | null }>
  }
  updater: {
    getStatus: () => Promise<AppUpdateStatus>
    check: () => Promise<AppUpdateStatus>
    download: () => Promise<AppUpdateStatus>
    install: () => Promise<{ success: boolean }>
    onStatus: (callback: (status: AppUpdateStatus) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: YtmApi
  }
}

export {}
