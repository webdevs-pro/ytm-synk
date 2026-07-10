import { app, BrowserWindow, shell } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'
import { authService } from './services/auth'
import { database } from './services/database'
import { logger } from './services/logger'
import { setMainWindow } from './services/window'

function resolveUserDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'ytm-synk')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'ytm-synk')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ytm-synk')
}

app.setPath('userData', resolveUserDataDir())

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'YouTube Music synchronizer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  setMainWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ytmsynk.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await authService.load()
  const retentionDays = database.getConfig().logRetentionDays
  const cleaned = logger.clearOldLogs(retentionDays)
  logger.info(
    `App started. Cleared ${cleaned.deleted} log file(s) older than ${retentionDays || 10} day(s).`
  )
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
