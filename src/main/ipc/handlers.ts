import { execFile } from 'child_process'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { promisify } from 'util'
import type { AppConfig, SyncLogEntry, SyncProgress, SyncSummary } from '../../shared/types'
import { IPC } from './channels'
import { authService } from '../services/auth'
import { database } from '../services/database'
import { downloaderService } from '../services/downloader'
import { logger } from '../services/logger'
import { getLogsDir, getPlaylistFolder } from '../services/paths'
import { syncService } from '../services/sync'
import {
  checkForAppUpdates,
  downloadAppUpdate,
  getUpdateStatus,
  installAppUpdate
} from '../services/updater'
import { getMainWindow } from '../services/window'
import { ytmusicService } from '../services/ytmusic'

const execFileAsync = promisify(execFile)

function clearTaskbarProgress(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  window.setProgressBar(-1, { mode: 'none' })
}

function setTaskbarIndeterminate(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  // Values > 1 show indeterminate progress on Windows.
  window.setProgressBar(2, { mode: 'indeterminate' })
}

function setTaskbarDeterminate(window: BrowserWindow | null, value: number): void {
  if (!window || window.isDestroyed()) return
  const clamped = Math.min(1, Math.max(0.01, value))
  window.setProgressBar(clamped, { mode: 'normal' })
}

function updateTaskbarProgress(
  window: BrowserWindow | null,
  progress: SyncProgress,
  playlistCount: number,
  completedPlaylists: number
): void {
  if (!window || window.isDestroyed()) return

  const count = Math.max(playlistCount, 1)

  if (progress.phase === 'fetching' || (progress.total <= 0 && progress.phase !== 'done')) {
    setTaskbarIndeterminate(window)
    return
  }

  const playlistFraction =
    progress.phase === 'done' ? 1 : Math.min(1, Math.max(0, progress.current / progress.total))
  const overall = (completedPlaylists + playlistFraction) / count
  setTaskbarDeterminate(window, overall)
}

async function executeSync(playlistIds?: string[]): Promise<SyncSummary> {
  if (syncService.isRunning()) {
    throw new Error('Sync is already running')
  }

  const window = getMainWindow()
  const playlistCount = playlistIds?.length ?? database.getConfig().selectedPlaylists.length
  let completedPlaylists = 0
  logger.startSyncSession(playlistIds)

  const sendProgress = (progress: SyncProgress): void => {
    updateTaskbarProgress(window, progress, playlistCount, completedPlaylists)
    if (progress.phase === 'done') {
      completedPlaylists++
    }
    window?.webContents.send(IPC.SYNC_PROGRESS, progress)
  }
  const sendLog = (entry: SyncLogEntry): void => {
    logger.writeSyncEntry(entry)
    window?.webContents.send(IPC.SYNC_LOG, entry)
  }

  setTaskbarIndeterminate(window)

  try {
    const summary = await syncService.run({ onProgress: sendProgress, onLog: sendLog }, playlistIds)
    logger.finishSyncSession(summary)
    setTaskbarDeterminate(window, 1)
    window?.webContents.send(IPC.SYNC_DONE, summary)
    return summary
  } catch (err) {
    const summary: SyncSummary = {
      downloaded: 0,
      deleted: 0,
      skipped: 0,
      errors: 1,
      playlists: 0
    }
    if (window && !window.isDestroyed()) {
      window.setProgressBar(1, { mode: 'error' })
    }
    sendLog({
      level: 'error',
      message: err instanceof Error ? err.message : 'Sync failed',
      timestamp: new Date().toISOString()
    })
    logger.finishSyncSession(summary, true)
    window?.webContents.send(IPC.SYNC_DONE, summary)
    throw err
  } finally {
    setTimeout(() => clearTaskbarProgress(window), 750)
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.AUTH_STATUS, () => authService.getStatus())

  ipcMain.handle(IPC.AUTH_LOGIN, async () => {
    const result = await authService.login()
    if (result.success) ytmusicService.resetClient()
    return result
  })

  ipcMain.handle(IPC.AUTH_LOGOUT, () => {
    authService.logout()
    ytmusicService.resetClient()
    return { success: true }
  })

  ipcMain.handle(IPC.AUTH_IMPORT_COOKIES, async (_event, filePath: string) => {
    const result = await authService.importCookiesFile(filePath)
    if (result.success) ytmusicService.resetClient()
    return result
  })

  ipcMain.handle(IPC.PLAYLISTS_LIST, async () => ytmusicService.getLibraryPlaylists())

  ipcMain.handle(IPC.PLAYLISTS_TOGGLE, (_event, playlistId: string, selected: boolean) =>
    database.toggleSelectedPlaylist(playlistId, selected)
  )

  ipcMain.handle(IPC.PLAYLISTS_ADD, async (_event, input: string) =>
    ytmusicService.addPlaylistById(input)
  )

  ipcMain.handle(
    IPC.PLAYLISTS_REMOVE,
    async (_event, playlistId: string, deleteFolder: boolean) => {
      const config = database.getConfig()
      const { folder, title } = database.removePlaylist(playlistId)

      if (deleteFolder && config.musicRoot) {
        const folderPath =
          folder || (title ? getPlaylistFolder(config.musicRoot, title) : null)
        if (folderPath && existsSync(folderPath)) {
          rmSync(folderPath, { recursive: true, force: true })
        }
      }

      return { success: true }
    }
  )

  ipcMain.handle(IPC.PLAYLISTS_SYNC, async (_event, playlistId: string) => executeSync([playlistId]))

  ipcMain.handle(IPC.SETTINGS_GET, () => database.getConfig())

  ipcMain.handle(IPC.SETTINGS_SET, (_event, partial: Partial<AppConfig>) => {
    const nextPartial = { ...partial }
    if (typeof nextPartial.logRetentionDays === 'number') {
      nextPartial.logRetentionDays = Math.min(
        365,
        Math.max(1, Math.floor(nextPartial.logRetentionDays))
      )
    }

    const next = database.updateConfig(nextPartial)
    if (typeof nextPartial.logRetentionDays === 'number') {
      const cleaned = logger.clearOldLogs(next.logRetentionDays)
      logger.info(
        `Log retention set to ${next.logRetentionDays} day(s). Cleared ${cleaned.deleted} old log file(s).`
      )
    }
    return next
  })

  ipcMain.handle(IPC.SETTINGS_PICK_MUSIC_ROOT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SETTINGS_PICK_COOKIES_FILE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Cookies', extensions: ['txt'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SETTINGS_OPEN_LOGS, async () => {
    const logsDir = getLogsDir()
    mkdirSync(logsDir, { recursive: true })
    logger.clearOldLogs(database.getConfig().logRetentionDays)
    await shell.openPath(logsDir)
  })

  ipcMain.handle(IPC.DOWNLOADER_INFO, async () => ({
    ...downloaderService.getInfo(),
    version: await downloaderService.getVersion()
  }))

  ipcMain.handle(IPC.DOWNLOADER_UPDATE, async () => {
    const script = app.isPackaged
      ? join(process.resourcesPath, 'scripts', 'download-binaries.js')
      : join(app.getAppPath(), 'scripts', 'download-binaries.js')
    const cwd = app.isPackaged ? process.resourcesPath : app.getAppPath()
    await execFileAsync(process.execPath, [script], {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    return {
      ...downloaderService.getInfo(),
      version: await downloaderService.getVersion()
    }
  })

  ipcMain.handle(IPC.APP_RELAUNCH, () => {
    app.relaunch()
    app.quit()
    return { success: true }
  })

  ipcMain.handle(IPC.UPDATER_GET_STATUS, () => getUpdateStatus())

  ipcMain.handle(IPC.UPDATER_CHECK, async () => checkForAppUpdates(true))

  ipcMain.handle(IPC.UPDATER_DOWNLOAD, async () => downloadAppUpdate())

  ipcMain.handle(IPC.UPDATER_INSTALL, () => {
    installAppUpdate()
    return { success: true }
  })

  ipcMain.handle(IPC.SYNC_RUN, async () => executeSync())
}
