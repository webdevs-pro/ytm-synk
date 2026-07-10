import { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
  if (!window) return

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })
}

export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  const preferred =
    windows.find((window) => window.getTitle().startsWith('YouTube Music synchronizer')) ??
    windows.find((window) => !window.getParentWindow()) ??
    windows[0] ??
    null

  mainWindow = preferred
  return preferred
}
