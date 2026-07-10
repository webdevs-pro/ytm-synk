import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import NodeID3 from 'node-id3'
import type {
  LocalTrack,
  PlaylistIndex,
  RemoteTrack,
  SyncLogEntry,
  SyncProgress,
  SyncSummary
} from '../../shared/types'
import { database } from './database'
import { DownloadCancelledError, downloaderService } from './downloader'
import { buildTrackFileName, extractVideoIdFromFileName, resolveUniqueFileName } from './filename'
import { getPlaylistFolder } from './paths'
import { ytmusicService } from './ytmusic'

export class SyncStoppedError extends Error {
  readonly summary: SyncSummary

  constructor(summary: SyncSummary) {
    super('Sync stopped')
    this.name = 'SyncStoppedError'
    this.summary = { ...summary, stopped: true }
  }
}

export type SyncEventEmitter = {
  onProgress: (progress: SyncProgress) => void
  onLog: (entry: SyncLogEntry) => void
}

function buildFolderTrackIndex(
  folder: string
): Map<string, { fileName: string; filePath: string }> {
  const index = new Map<string, { fileName: string; filePath: string }>()

  try {
    for (const entry of readdirSync(folder)) {
      if (!entry.toLowerCase().endsWith('.mp3')) continue
      const filePath = join(folder, entry)
      if (!existsSync(filePath)) continue

      const videoId = extractVideoIdFromFileName(entry)
      if (!videoId || index.has(videoId)) continue
      index.set(videoId, { fileName: entry, filePath })
    }
  } catch {
    return index
  }

  return index
}

function resolveVideoIdFromFileName(fileName: string, candidateIds: Set<string>): string | null {
  const extracted = extractVideoIdFromFileName(fileName)
  if (extracted) return extracted

  for (const videoId of candidateIds) {
    if (fileName.includes(videoId)) return videoId
  }

  return null
}

function collectOrphanFiles(
  folder: string,
  remoteIds: Set<string>,
  existing: PlaylistIndex,
  folderIndex: Map<string, { fileName: string; filePath: string }>
): Map<string, { videoId: string | null; label: string }> {
  const orphans = new Map<string, { videoId: string | null; label: string }>()
  const candidateIds = new Set<string>([
    ...remoteIds,
    ...Object.keys(existing.tracks),
    ...folderIndex.keys()
  ])

  for (const [videoId, local] of Object.entries(existing.tracks)) {
    if (remoteIds.has(videoId)) continue
    if (!local.filePath) continue
    orphans.set(local.filePath, { videoId, label: local.title })
  }

  let entries: string[] = []
  try {
    entries = readdirSync(folder)
  } catch {
    return orphans
  }

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.mp3')) continue
    const filePath = join(folder, entry)
    if (!existsSync(filePath)) continue

    const videoId = resolveVideoIdFromFileName(entry, candidateIds)
    if (!videoId || remoteIds.has(videoId)) continue

    const indexed = existing.tracks[videoId]
    orphans.set(filePath, { videoId, label: indexed?.title ?? entry })
  }

  return orphans
}

function findTrackFileOnDisk(
  folder: string,
  videoId: string,
  artist: string,
  title: string
): { fileName: string; filePath: string } | null {
  const expectedPath = join(folder, buildTrackFileName(artist, title, videoId))
  if (existsSync(expectedPath)) {
    return { fileName: buildTrackFileName(artist, title, videoId), filePath: expectedPath }
  }

  try {
    for (const entry of readdirSync(folder)) {
      if (!entry.toLowerCase().endsWith('.mp3')) continue
      if (!entry.includes(videoId)) continue
      const filePath = join(folder, entry)
      if (existsSync(filePath)) {
        return { fileName: entry, filePath }
      }
    }
  } catch {
    return null
  }

  return null
}

function adoptExistingTrack(
  existing: PlaylistIndex,
  folder: string,
  track: RemoteTrack,
  folderIndex: Map<string, { fileName: string; filePath: string }>
): LocalTrack | null {
  const local = existing.tracks[track.videoId]
  if (local?.filePath && existsSync(local.filePath)) {
    return local
  }

  const fromFolder = folderIndex.get(track.videoId)
  if (fromFolder) {
    const adopted: LocalTrack = {
      videoId: track.videoId,
      title: track.title,
      artists: track.artists,
      durationSec: track.durationSec,
      fileName: fromFolder.fileName,
      filePath: fromFolder.filePath,
      downloadedAt: local?.downloadedAt ?? new Date().toISOString()
    }
    existing.tracks[track.videoId] = adopted
    return adopted
  }

  const artist = track.artists[0] || 'Unknown Artist'
  const onDisk = findTrackFileOnDisk(folder, track.videoId, artist, track.title)
  if (!onDisk) return null

  const adopted: LocalTrack = {
    videoId: track.videoId,
    title: track.title,
    artists: track.artists,
    durationSec: track.durationSec,
    fileName: onDisk.fileName,
    filePath: onDisk.filePath,
    downloadedAt: local?.downloadedAt ?? new Date().toISOString()
  }
  existing.tracks[track.videoId] = adopted
  return adopted
}

function formatTrackLabel(track: RemoteTrack): string {
  const artist = track.artists.filter(Boolean).join(', ') || 'Unknown Artist'
  return `${artist} - ${track.title}`
}

export class SyncService {
  private running = false
  private stopRequested = false

  isRunning(): boolean {
    return this.running
  }

  stop(): boolean {
    if (!this.running) return false
    this.stopRequested = true
    downloaderService.cancel()
    return true
  }

  private assertNotStopped(summary: SyncSummary): void {
    if (this.stopRequested) {
      throw new SyncStoppedError(summary)
    }
  }

  async run(emit: SyncEventEmitter, playlistIds?: string[]): Promise<SyncSummary> {
    if (this.running) {
      throw new Error('Sync is already running')
    }

    this.running = true
    this.stopRequested = false
    const summary: SyncSummary = {
      downloaded: 0,
      deleted: 0,
      skipped: 0,
      errors: 0,
      playlists: 0
    }

    try {
      const config = database.getConfig()
      if (!config.musicRoot) {
        throw new Error('Music folder is not configured. Open Settings and choose a folder.')
      }

      const targets = playlistIds ?? config.selectedPlaylists
      if (targets.length === 0) {
        throw new Error(
          playlistIds
            ? 'No playlist specified.'
            : 'No playlists selected. Choose playlists to mirror first.'
        )
      }

      mkdirSync(config.musicRoot, { recursive: true })

      for (const playlistId of targets) {
        this.assertNotStopped(summary)
        try {
          await this.syncPlaylist(playlistId, config.musicRoot, config.downloadQuality, emit, summary)
          summary.playlists++
        } catch (err) {
          if (err instanceof SyncStoppedError) throw err
          summary.errors++
          emit.onLog({
            level: 'error',
            message: err instanceof Error ? err.message : 'Playlist sync failed',
            timestamp: new Date().toISOString(),
            playlistId
          })
        }
      }

      return summary
    } finally {
      this.running = false
      this.stopRequested = false
    }
  }

  private async syncPlaylist(
    playlistId: string,
    musicRoot: string,
    quality: string,
    emit: SyncEventEmitter,
    summary: SyncSummary
  ): Promise<void> {
    emit.onProgress({
      playlistId,
      playlistName: playlistId,
      phase: 'fetching',
      current: 0,
      total: 0
    })

    const remote = await ytmusicService.getPlaylistTracks(playlistId)
    const folder = getPlaylistFolder(musicRoot, remote.name)
    mkdirSync(folder, { recursive: true })

    const existing =
      database.getPlaylistIndex(playlistId) ??
      ({
        id: playlistId,
        name: remote.name,
        lastSyncedAt: null,
        folder,
        tracks: {}
      } satisfies PlaylistIndex)

    existing.name = remote.name
    existing.folder = folder

    const folderIndex = buildFolderTrackIndex(folder)
    const remoteIds = new Set(remote.tracks.map((track) => track.videoId))

    const toDownload: RemoteTrack[] = []
    const toKeep: RemoteTrack[] = []

    for (const track of remote.tracks) {
      const adopted = adoptExistingTrack(existing, folder, track, folderIndex)
      if (adopted) {
        toKeep.push(track)
        continue
      }
      toDownload.push(track)
    }

    const orphans = collectOrphanFiles(folder, remoteIds, existing, folderIndex)
    database.savePlaylistIndex(existing)

    const workTotal = Math.max(orphans.size + remote.tracks.length, 1)
    let workCurrent = 0

    const emitWork = (
      phase: SyncProgress['phase'],
      currentTrack?: string
    ): void => {
      emit.onProgress({
        playlistId,
        playlistName: remote.name,
        phase,
        current: workCurrent,
        total: workTotal,
        currentTrack
      })
    }

    emitWork('deleting')

    for (const [filePath, orphan] of orphans) {
      this.assertNotStopped(summary)
      if (orphan.videoId) {
        delete existing.tracks[orphan.videoId]
      }

      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath)
          summary.deleted++
          emit.onLog({
            level: 'success',
            message: `Deleted: ${orphan.label}`,
            timestamp: new Date().toISOString(),
            playlistId,
            videoId: orphan.videoId ?? undefined
          })
        } catch (err) {
          summary.errors++
          emit.onLog({
            level: 'error',
            message: `Failed to delete ${orphan.label}: ${err instanceof Error ? err.message : 'unknown error'}`,
            timestamp: new Date().toISOString(),
            playlistId,
            videoId: orphan.videoId ?? undefined
          })
        }
      }

      workCurrent++
      emitWork('deleting', orphan.label)
    }

    database.savePlaylistIndex(existing)
    emitWork('downloading')

    const keepIds = new Set(toKeep.map((track) => track.videoId))

    for (const track of remote.tracks) {
      this.assertNotStopped(summary)

      if (keepIds.has(track.videoId)) {
        workCurrent++
        emitWork('downloading', `Skipped: ${formatTrackLabel(track)}`)
        continue
      }

      emitWork('downloading', formatTrackLabel(track))

      try {
        const artist = track.artists[0] || 'Unknown Artist'
        const desiredName = buildTrackFileName(artist, track.title, track.videoId)
        const fileName = resolveUniqueFileName(
          folder,
          desiredName,
          track.videoId,
          (path) => existsSync(path),
          join
        )

        const result = await downloaderService.download({
          videoId: track.videoId,
          outputDir: folder,
          outputTemplate: fileName.replace(/\.mp3$/i, '.%(ext)s'),
          expectedFileName: fileName,
          quality,
          onProgress: (percent) => {
            emitWork('downloading', `${formatTrackLabel(track)} (${percent}%)`)
          }
        })

        await this.writeTags(result.filePath, track, remote.name)

        existing.tracks[track.videoId] = {
          videoId: track.videoId,
          title: track.title,
          artists: track.artists,
          durationSec: track.durationSec,
          fileName,
          filePath: result.filePath,
          downloadedAt: new Date().toISOString()
        }
        database.savePlaylistIndex(existing)

        summary.downloaded++
        emit.onLog({
          level: 'success',
          message: `Downloaded: ${formatTrackLabel(track)}`,
          timestamp: new Date().toISOString(),
          playlistId,
          videoId: track.videoId
        })
      } catch (err) {
        if (err instanceof DownloadCancelledError || err instanceof SyncStoppedError) {
          throw new SyncStoppedError(summary)
        }
        summary.errors++
        emit.onLog({
          level: 'error',
          message: `Failed to download ${formatTrackLabel(track)}: ${err instanceof Error ? err.message : 'unknown error'}`,
          timestamp: new Date().toISOString(),
          playlistId,
          videoId: track.videoId
        })
      }

      workCurrent++
      emitWork('downloading', formatTrackLabel(track))
    }

    summary.skipped += toKeep.length
    for (const track of toKeep) {
      emit.onLog({
        level: 'info',
        message: `Skipped (already synced): ${formatTrackLabel(track)}`,
        timestamp: new Date().toISOString(),
        playlistId,
        videoId: track.videoId
      })
    }

    existing.lastSyncedAt = new Date().toISOString()
    database.savePlaylistIndex(existing, true)

    emit.onProgress({
      playlistId,
      playlistName: remote.name,
      phase: 'done',
      current: workTotal,
      total: workTotal
    })

    emit.onLog({
      level: 'info',
      message: `Finished playlist: ${remote.name}`,
      timestamp: new Date().toISOString(),
      playlistId
    })
  }

  private async writeTags(filePath: string, track: RemoteTrack, album: string): Promise<void> {
    const tags: NodeID3.Tags = {
      title: track.title,
      artist: track.artists.join(', ') || 'Unknown Artist',
      album
    }

    if (track.thumbnailUrl) {
      try {
        const response = await fetch(track.thumbnailUrl)
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer())
          tags.image = {
            mime: 'image/jpeg',
            type: { id: 3, name: 'front cover' },
            description: 'Cover',
            imageBuffer: buffer
          }
        }
      } catch {
        // Cover art is optional
      }
    }

    NodeID3.update(tags, filePath)
  }
}

export const syncService = new SyncService()
