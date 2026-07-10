import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type { AppUpdateStatus, SyncLogEntry, SyncProgress, SyncSummary } from '../shared/types'
import type { YtmApi } from './index.d'

const api: YtmApi = {
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_STATUS),
    login: () => ipcRenderer.invoke(IPC.AUTH_LOGIN),
    logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
    importCookies: (filePath) => ipcRenderer.invoke(IPC.AUTH_IMPORT_COOKIES, filePath)
  },
  playlists: {
    list: () => ipcRenderer.invoke(IPC.PLAYLISTS_LIST),
    toggle: (playlistId, selected) => ipcRenderer.invoke(IPC.PLAYLISTS_TOGGLE, playlistId, selected),
    add: (input) => ipcRenderer.invoke(IPC.PLAYLISTS_ADD, input),
    remove: (playlistId, deleteFolder) =>
      ipcRenderer.invoke(IPC.PLAYLISTS_REMOVE, playlistId, deleteFolder),
    sync: (playlistId) => ipcRenderer.invoke(IPC.PLAYLISTS_SYNC, playlistId)
  },
  sync: {
    run: () => ipcRenderer.invoke(IPC.SYNC_RUN),
    stop: () => ipcRenderer.invoke(IPC.SYNC_STOP),
    isRunning: () => ipcRenderer.invoke(IPC.SYNC_IS_RUNNING),
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: SyncProgress): void =>
        callback(progress)
      ipcRenderer.on(IPC.SYNC_PROGRESS, listener)
      return () => ipcRenderer.removeListener(IPC.SYNC_PROGRESS, listener)
    },
    onLog: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, entry: SyncLogEntry): void =>
        callback(entry)
      ipcRenderer.on(IPC.SYNC_LOG, listener)
      return () => ipcRenderer.removeListener(IPC.SYNC_LOG, listener)
    },
    onDone: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, summary: SyncSummary): void =>
        callback(summary)
      ipcRenderer.on(IPC.SYNC_DONE, listener)
      return () => ipcRenderer.removeListener(IPC.SYNC_DONE, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (partial) => ipcRenderer.invoke(IPC.SETTINGS_SET, partial),
    pickMusicRoot: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_MUSIC_ROOT),
    pickCookiesFile: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_COOKIES_FILE),
    openLogs: () => ipcRenderer.invoke(IPC.SETTINGS_OPEN_LOGS)
  },
  downloader: {
    info: () => ipcRenderer.invoke(IPC.DOWNLOADER_INFO),
    update: () => ipcRenderer.invoke(IPC.DOWNLOADER_UPDATE)
  },
  app: {
    relaunch: () => ipcRenderer.invoke(IPC.APP_RELAUNCH)
  },
  updater: {
    getStatus: () => ipcRenderer.invoke(IPC.UPDATER_GET_STATUS),
    check: () => ipcRenderer.invoke(IPC.UPDATER_CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
    install: () => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
    onStatus: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus): void =>
        callback(status)
      ipcRenderer.on(IPC.UPDATER_STATUS, listener)
      return () => ipcRenderer.removeListener(IPC.UPDATER_STATUS, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  const globalWindow = window as unknown as Window & { electron: typeof electronAPI; api: YtmApi }
  globalWindow.electron = electronAPI
  globalWindow.api = api
}
