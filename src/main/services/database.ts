import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig, PlaylistIndex, PlaylistSummary, SavedPlaylistMeta } from '../../shared/types'
import {
  getBackupsDir,
  getConfigPath,
  getPlaylistsIndexDir,
  getUserDataPath
} from './paths'

const DEFAULT_CONFIG: AppConfig = {
  musicRoot: '',
  selectedPlaylists: [],
  manualPlaylists: [],
  downloadFormat: 'mp3',
  downloadQuality: 'best',
  logRetentionDays: 10
}

function ensureUserData(): void {
  mkdirSync(getUserDataPath(), { recursive: true })
  mkdirSync(getPlaylistsIndexDir(), { recursive: true })
  mkdirSync(getBackupsDir(), { recursive: true })
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
  renameSync(tmpPath, filePath)
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

export class DatabaseService {
  getConfig(): AppConfig {
    ensureUserData()
    return { ...DEFAULT_CONFIG, ...readJsonFile<Partial<AppConfig>>(getConfigPath(), {}) }
  }

  saveConfig(config: AppConfig): void {
    ensureUserData()
    atomicWriteJson(getConfigPath(), config)
  }

  updateConfig(partial: Partial<AppConfig>): AppConfig {
    const next = { ...this.getConfig(), ...partial }
    this.saveConfig(next)
    return next
  }

  getPlaylistIndexPath(playlistId: string): string {
    const safeId = playlistId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(getPlaylistsIndexDir(), `${safeId}.json`)
  }

  getPlaylistIndex(playlistId: string): PlaylistIndex | null {
    const path = this.getPlaylistIndexPath(playlistId)
    if (!existsSync(path)) return null
    return readJsonFile<PlaylistIndex | null>(path, null)
  }

  savePlaylistIndex(index: PlaylistIndex, backup = false): void {
    ensureUserData()
    const path = this.getPlaylistIndexPath(index.id)
    if (backup && existsSync(path)) {
      const backupPath = join(getBackupsDir(), `${index.id}-${Date.now()}.json`)
      copyFileSync(path, backupPath)
    }
    atomicWriteJson(path, index)
  }

  deletePlaylistIndex(playlistId: string): void {
    const path = this.getPlaylistIndexPath(playlistId)
    if (existsSync(path)) unlinkSync(path)
  }

  toggleSelectedPlaylist(playlistId: string, selected: boolean): AppConfig {
    const config = this.getConfig()
    const set = new Set(config.selectedPlaylists)
    if (selected) set.add(playlistId)
    else set.delete(playlistId)
    return this.updateConfig({ selectedPlaylists: [...set] })
  }

  removePlaylist(playlistId: string): { folder: string | null; title: string | null } {
    const config = this.getConfig()
    const index = this.getPlaylistIndex(playlistId)
    const manual = (config.manualPlaylists ?? []).find((playlist) => playlist.id === playlistId)

    this.updateConfig({
      manualPlaylists: (config.manualPlaylists ?? []).filter((playlist) => playlist.id !== playlistId),
      selectedPlaylists: config.selectedPlaylists.filter((id) => id !== playlistId)
    })
    this.deletePlaylistIndex(playlistId)

    return {
      folder: index?.folder || null,
      title: index?.name || manual?.title || null
    }
  }

  saveManualPlaylist(summary: PlaylistSummary): AppConfig {
    const config = this.getConfig()
    const manualPlaylists = [
      {
        id: summary.id,
        title: summary.title,
        count: summary.count,
        thumbnails: summary.thumbnails
      } satisfies SavedPlaylistMeta,
      ...(config.manualPlaylists ?? []).filter((playlist) => playlist.id !== summary.id)
    ]
    return this.updateConfig({ manualPlaylists })
  }

  getManualPlaylistSummaries(): PlaylistSummary[] {
    const config = this.getConfig()
    let manualPlaylists = config.manualPlaylists ?? []

    if (manualPlaylists.length === 0 && config.selectedPlaylists.length > 0) {
      const migrated: SavedPlaylistMeta[] = []
      for (const playlistId of config.selectedPlaylists) {
        const index = this.getPlaylistIndex(playlistId)
        if (!index) continue
        migrated.push({
          id: index.id,
          title: index.name,
          count: Object.keys(index.tracks).length,
          thumbnails: []
        })
      }
      if (migrated.length > 0) {
        manualPlaylists = migrated
        this.updateConfig({ manualPlaylists })
      }
    }

    return manualPlaylists.map((playlist) => ({
      id: playlist.id,
      title: playlist.title,
      count: playlist.count,
      thumbnails: playlist.thumbnails,
      selected: config.selectedPlaylists.includes(playlist.id),
      lastSyncedAt: this.getPlaylistIndex(playlist.id)?.lastSyncedAt ?? null,
      manual: true
    }))
  }

  ensurePlaylistIndexStub(playlistId: string, name: string): void {
    const existing = this.getPlaylistIndex(playlistId)
    if (existing) {
      if (existing.name !== name) {
        this.savePlaylistIndex({ ...existing, name })
      }
      return
    }

    this.savePlaylistIndex({
      id: playlistId,
      name,
      lastSyncedAt: null,
      folder: '',
      tracks: {}
    })
  }
}

export const database = new DatabaseService()
