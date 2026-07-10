import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { SyncLogEntry, SyncSummary } from '../../shared/types'
import { getLogsDir } from './paths'

const DEFAULT_RETENTION_DAYS = 10
const MS_PER_DAY = 24 * 60 * 60 * 1000

function stamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

function ensureLogsDir(): string {
  const dir = getLogsDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

function formatLine(level: string, message: string, timestamp = new Date().toISOString()): string {
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`
}

function normalizeRetentionDays(days: number | undefined): number {
  if (typeof days !== 'number' || Number.isNaN(days)) return DEFAULT_RETENTION_DAYS
  return Math.min(365, Math.max(1, Math.floor(days)))
}

export class LoggerService {
  private activeSyncLogPath: string | null = null

  info(message: string): void {
    this.writeAppLog('info', message)
  }

  error(message: string): void {
    this.writeAppLog('error', message)
  }

  startSyncSession(playlistIds?: string[]): string {
    const dir = ensureLogsDir()
    const suffix = playlistIds?.length === 1 ? `-${playlistIds[0].slice(0, 24)}` : ''
    const filePath = join(dir, `sync-${stamp()}${suffix}.log`)
    this.activeSyncLogPath = filePath

    const scope =
      playlistIds && playlistIds.length > 0
        ? `playlists: ${playlistIds.join(', ')}`
        : 'all selected playlists'
    this.append(filePath, formatLine('info', `Sync started (${scope})`))
    return filePath
  }

  writeSyncEntry(entry: SyncLogEntry): void {
    if (!this.activeSyncLogPath) return
    const extras = [entry.playlistId, entry.videoId].filter(Boolean).join(' ')
    const message = extras ? `${entry.message} (${extras})` : entry.message
    this.append(this.activeSyncLogPath, formatLine(entry.level, message, entry.timestamp))
  }

  finishSyncSession(summary: SyncSummary, failed = false): void {
    if (!this.activeSyncLogPath) return
    this.append(
      this.activeSyncLogPath,
      formatLine(
        failed ? 'error' : 'info',
        `Sync ${failed ? 'failed' : 'finished'}. Downloaded ${summary.downloaded}, deleted ${summary.deleted}, skipped ${summary.skipped}, errors ${summary.errors}, playlists ${summary.playlists}`
      )
    )
    this.activeSyncLogPath = null
  }

  clearOldLogs(retentionDays?: number): { deleted: number; kept: number } {
    const days = normalizeRetentionDays(retentionDays)
    const dir = ensureLogsDir()
    const cutoff = Date.now() - days * MS_PER_DAY
    let deleted = 0
    let kept = 0

    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return { deleted: 0, kept: 0 }
    }

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.log')) {
        kept++
        continue
      }

      const filePath = join(dir, entry)
      if (this.activeSyncLogPath && filePath === this.activeSyncLogPath) {
        kept++
        continue
      }

      let mtimeMs = 0
      try {
        mtimeMs = statSync(filePath).mtimeMs
      } catch {
        continue
      }

      if (mtimeMs < cutoff) {
        try {
          unlinkSync(filePath)
          deleted++
        } catch {
          kept++
        }
      } else {
        kept++
      }
    }

    return { deleted, kept }
  }

  private writeAppLog(level: 'info' | 'error', message: string): void {
    const dir = ensureLogsDir()
    const day = new Date().toISOString().slice(0, 10)
    const filePath = join(dir, `app-${day}.log`)
    this.append(filePath, formatLine(level, message))
  }

  private append(filePath: string, line: string): void {
    try {
      appendFileSync(filePath, `${line}\n`, 'utf-8')
    } catch {
      // Logging must never break sync/auth flows.
    }
  }
}

export const logger = new LoggerService()
