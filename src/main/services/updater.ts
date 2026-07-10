import { app, dialog } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { AppUpdateStatus } from '../../shared/types'
import { logger } from './logger'
import { getMainWindow } from './window'
import { IPC } from '../ipc/channels'

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.logger = {
  info: (message?: unknown) => logger.info(String(message ?? '')),
  warn: (message?: unknown) => logger.info(`WARN ${String(message ?? '')}`),
  error: (message?: unknown) => logger.error(String(message ?? '')),
  debug: () => undefined
}

let currentStatus: AppUpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion(),
  packaged: app.isPackaged
}

function setStatus(status: AppUpdateStatus): void {
  currentStatus = status
  const window = getMainWindow()
  window?.webContents.send(IPC.UPDATER_STATUS, status)
}

function versionFromInfo(info: UpdateInfo | undefined): string | null {
  return info?.version ?? null
}

export function getUpdateStatus(): AppUpdateStatus {
  return currentStatus
}

export async function checkForAppUpdates(_manual = false): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    const status: AppUpdateStatus = {
      state: 'unavailable',
      currentVersion: app.getVersion(),
      packaged: false,
      message: 'Updates are only available in the installed app.'
    }
    setStatus(status)
    return status
  }

  setStatus({
    state: 'checking',
    currentVersion: app.getVersion(),
    packaged: true
  })

  try {
    await autoUpdater.checkForUpdates()

    // Events usually update status before this resolves. If nothing changed, treat as up to date.
    if (currentStatus.state === 'checking') {
      const status: AppUpdateStatus = {
        state: 'upToDate',
        currentVersion: app.getVersion(),
        packaged: true
      }
      setStatus(status)
    }

    return currentStatus
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to check for updates'
    const status: AppUpdateStatus = {
      state: 'error',
      currentVersion: app.getVersion(),
      packaged: true,
      message
    }
    setStatus(status)
    logger.error(`Update check failed: ${message}`)
    return status
  }
}

export function installAppUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall(false, true)
}

export function initAutoUpdater(): void {
  autoUpdater.on('checking-for-update', () => {
    setStatus({
      state: 'checking',
      currentVersion: app.getVersion(),
      packaged: app.isPackaged
    })
  })

  autoUpdater.on('update-available', (info) => {
    const version = versionFromInfo(info) || 'unknown'
    setStatus({
      state: 'available',
      currentVersion: app.getVersion(),
      availableVersion: version,
      packaged: true
    })
    logger.info(`Update available: ${version}`)
  })

  autoUpdater.on('update-not-available', () => {
    setStatus({
      state: 'upToDate',
      currentVersion: app.getVersion(),
      packaged: true
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      state: 'downloading',
      currentVersion: app.getVersion(),
      availableVersion:
        currentStatus.state === 'available' ||
        currentStatus.state === 'downloading' ||
        currentStatus.state === 'downloaded'
          ? currentStatus.availableVersion
          : undefined,
      percent: progress.percent,
      packaged: true
    })
  })

  autoUpdater.on('update-downloaded', async (info) => {
    const version = versionFromInfo(info) || 'unknown'
    setStatus({
      state: 'downloaded',
      currentVersion: app.getVersion(),
      availableVersion: version,
      packaged: true
    })
    logger.info(`Update downloaded: ${version}`)

    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: `Version ${version} is ready to install`,
      detail: 'Restart YTM-Synk to apply the update.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })

    if (result.response === 0) {
      installAppUpdate()
    }
  })

  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : 'Update error'
    setStatus({
      state: 'error',
      currentVersion: app.getVersion(),
      packaged: app.isPackaged,
      message
    })
    logger.error(`Updater error: ${message}`)
  })

  if (!app.isPackaged) {
    setStatus({
      state: 'unavailable',
      currentVersion: app.getVersion(),
      packaged: false,
      message: 'Updates are only available in the installed app.'
    })
    return
  }

  // Quiet launch check after the window is up.
  setTimeout(() => {
    void checkForAppUpdates(false)
  }, 4000)
}
