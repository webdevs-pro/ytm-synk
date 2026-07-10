import YTMusic from 'ytmusic-api'
import type { PlaylistSummary, RemoteTrack } from '../../shared/types'
import { authService } from './auth'
import {
  configureYtmusicClient,
  parsePlaylistId,
  syncNetscapeCookiesToSession,
  type YtmCookieClient
} from './cookies'
import { database } from './database'

type YtmClient = YtmCookieClient & {
  getPlaylist: (playlistId: string) => Promise<{
    playlistId: string
    name: string
    videoCount: number
    thumbnails: Array<{ url: string; width: number; height: number }>
  }>
  constructRequest: (
    endpoint: string,
    body?: Record<string, unknown>,
    query?: Record<string, string>
  ) => Promise<unknown>
}

export class YTMusicService {
  private client: YtmClient | null = null

  private async createClient(): Promise<YtmClient> {
    await syncNetscapeCookiesToSession()
    const cookieHeader = await authService.getApiCookieHeader()
    if (!cookieHeader) {
      throw new Error('Not authenticated. Please sign in to YouTube Music.')
    }

    const client = new YTMusic() as unknown as YtmClient
    await client.initialize({ cookies: cookieHeader })
    configureYtmusicClient(client, cookieHeader)
    return client
  }

  async ensureClient(): Promise<YtmClient> {
    if (this.client) return this.client

    const client = await this.createClient()
    this.client = client
    return client
  }

  async addPlaylistById(input: string): Promise<PlaylistSummary> {
    const playlistId = parsePlaylistId(input)
    if (!playlistId) {
      throw new Error('Invalid playlist URL or ID')
    }

    let client: YtmClient
    try {
      client = this.client ?? (await this.createClient())
      const meta = await client.getPlaylist(playlistId)
      this.client = client
      const config = database.toggleSelectedPlaylist(meta.playlistId, true)
      database.ensurePlaylistIndexStub(meta.playlistId, meta.name)

      const summary: PlaylistSummary = {
        id: meta.playlistId,
        title: meta.name,
        count: meta.videoCount,
        thumbnails: meta.thumbnails,
        selected: config.selectedPlaylists.includes(meta.playlistId),
        lastSyncedAt: database.getPlaylistIndex(meta.playlistId)?.lastSyncedAt ?? null
      }
      database.saveManualPlaylist(summary)
      return summary
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load playlist'
      throw new Error(
        `${message}. Sign in again or import cookies.txt from a browser where YouTube Music works.`
      )
    }
  }

  resetClient(): void {
    this.client = null
  }

  async getLibraryPlaylists(): Promise<PlaylistSummary[]> {
    const config = database.getConfig()
    const merged = new Map<string, PlaylistSummary>()

    for (const playlist of database.getManualPlaylistSummaries()) {
      merged.set(playlist.id, playlist)
    }

    try {
      const client = await this.ensureClient()
      const playlists: PlaylistSummary[] = []

      let continuation: string | null = null
      let data = await client.constructRequest('browse', { browseId: 'FEmusic_liked_playlists' })

      const collect = (response: unknown): void => {
        const items = extractGridPlaylistItems(response)
        for (const item of items) {
          const local = database.getPlaylistIndex(item.id)
          playlists.push({
            id: item.id,
            title: item.title,
            count: item.count,
            thumbnails: item.thumbnails,
            selected: config.selectedPlaylists.includes(item.id),
            lastSyncedAt: local?.lastSyncedAt ?? null
          })
        }
        continuation = extractContinuation(response)
      }

      collect(data)
      while (continuation) {
        data = await client.constructRequest('browse', { browseId: 'FEmusic_liked_playlists' }, {
          continuation
        })
        collect(data)
      }

      for (const playlist of playlists) {
        merged.set(playlist.id, playlist)
      }
    } catch {
      // Library browse is unavailable for some accounts.
    }

    for (const playlistId of config.selectedPlaylists) {
      if (merged.has(playlistId)) continue

      const index = database.getPlaylistIndex(playlistId)
      if (index) {
        merged.set(playlistId, {
          id: index.id,
          title: index.name,
          count: Object.keys(index.tracks).length,
          thumbnails: [],
          selected: true,
          lastSyncedAt: index.lastSyncedAt
        })
      }
    }

    for (const playlist of merged.values()) {
      playlist.selected = config.selectedPlaylists.includes(playlist.id)
    }

    return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  async getPlaylistTracks(playlistId: string): Promise<{ name: string; tracks: RemoteTrack[] }> {
    const client = await this.ensureClient()
    const meta = await client.getPlaylist(playlistId)
    const videos = await fetchAllPlaylistVideos(client, playlistId)

    const tracks: RemoteTrack[] = videos
      .filter((video) => Boolean(video.videoId))
      .map((video) => ({
        videoId: video.videoId,
        title: video.name,
        artists: [video.artist?.name || 'Unknown Artist'],
        durationSec: video.duration,
        thumbnailUrl: video.thumbnails?.[0]?.url ?? null
      }))

    return { name: meta.name, tracks }
  }
}

type PlaylistVideo = {
  videoId: string
  name: string
  artist: { name: string }
  duration: number | null
  thumbnails: Array<{ url: string; width: number; height: number }>
}

async function fetchAllPlaylistVideos(
  client: YtmClient,
  playlistId: string
): Promise<PlaylistVideo[]> {
  let browseId = playlistId
  if (browseId.startsWith('PL')) browseId = `VL${browseId}`

  const videos = new Map<string, PlaylistVideo>()
  const response = await client.constructRequest('browse', { browseId })
  const shelf = findPlaylistShelfRenderer(response)

  if (shelf) {
    collectPlaylistVideosFromContents(shelf.contents, videos)
    let next = detectPlaylistContinuation(shelf)
    let pages = 0

    while (next && pages < 500) {
      pages++
      const page =
        next.mode === '2025'
          ? await client.constructRequest('browse', { continuation: next.token })
          : await client.constructRequest('browse', {}, { continuation: next.token })

      if (next.mode === '2025') {
        const continuationItems = extractAppendContinuationItems(page)
        collectPlaylistVideosFromContents(continuationItems, videos)
        const token = getContinuationTokenFromContents(continuationItems)
        next = token ? { token, mode: '2025' } : null
      } else {
        collectPlaylistVideosFromLegacyContinuation(page, videos)
        next = detectLegacyContinuation(page)
      }
    }

    return [...videos.values()]
  }

  collectPlaylistVideosFromResponse(response, videos)
  let legacyToken = extractLegacyContinuationToken(response)
  let pages = 0

  while (legacyToken && pages < 500) {
    pages++
    const page = await client.constructRequest('browse', {}, { continuation: legacyToken })
    collectPlaylistVideosFromLegacyContinuation(page, videos)
    legacyToken = extractLegacyContinuationToken(page)
  }

  return [...videos.values()]
}

function collectPlaylistVideos(
  items: Array<Record<string, unknown>>,
  videos: Map<string, PlaylistVideo>
): void {
  for (const item of items) {
    const parsed = parsePlaylistVideoItem(item)
    if (parsed) videos.set(parsed.videoId, parsed)
  }
}

function collectPlaylistVideosFromContents(
  contents: unknown,
  videos: Map<string, PlaylistVideo>
): void {
  if (!Array.isArray(contents)) return
  const items: Array<Record<string, unknown>> = []
  for (const entry of contents) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const renderer = record.musicResponsiveListItemRenderer
    if (renderer && typeof renderer === 'object') {
      items.push(renderer as Record<string, unknown>)
    }
  }
  collectPlaylistVideos(items, videos)
}

function collectPlaylistVideosFromResponse(
  response: unknown,
  videos: Map<string, PlaylistVideo>
): void {
  collectPlaylistVideos(extractPlaylistVideoItems(response), videos)
}

function collectPlaylistVideosFromLegacyContinuation(
  response: unknown,
  videos: Map<string, PlaylistVideo>
): void {
  collectPlaylistVideos(extractPlaylistVideoItems(response), videos)
}

function findPlaylistShelfRenderer(response: unknown): Record<string, unknown> | null {
  const shelf = deepFind(response, 'musicPlaylistShelfRenderer')
  if (shelf && typeof shelf === 'object' && Array.isArray((shelf as Record<string, unknown>).contents)) {
    return shelf as Record<string, unknown>
  }
  return null
}

type PlaylistContinuation = { token: string; mode: '2025' | 'legacy' }

function detectPlaylistContinuation(shelf: Record<string, unknown>): PlaylistContinuation | null {
  const token2025 = getContinuationTokenFromContents(shelf.contents)
  if (token2025) return { token: token2025, mode: '2025' }

  const tokenLegacy = tokenFromContinuations(shelf.continuations)
  if (tokenLegacy) return { token: tokenLegacy, mode: 'legacy' }

  return null
}

function detectLegacyContinuation(response: unknown): PlaylistContinuation | null {
  const token = extractLegacyContinuationToken(response)
  return token ? { token, mode: 'legacy' } : null
}

function extractLegacyContinuationToken(response: unknown): string | null {
  const contContents = deepFind(response, 'continuationContents')
  if (contContents && typeof contContents === 'object') {
    const shelf = (contContents as Record<string, unknown>).musicPlaylistShelfContinuation
    if (shelf && typeof shelf === 'object') {
      const token = tokenFromContinuations((shelf as Record<string, unknown>).continuations)
      if (token) return token
    }
  }

  const shelfContinuation = deepFind(response, 'musicPlaylistShelfContinuation')
  if (shelfContinuation && typeof shelfContinuation === 'object') {
    const token = tokenFromContinuations((shelfContinuation as Record<string, unknown>).continuations)
    if (token) return token
  }

  return null
}

function getContinuationTokenFromContents(contents: unknown): string | null {
  if (!Array.isArray(contents) || contents.length === 0) return null

  const last = contents[contents.length - 1]
  if (!last || typeof last !== 'object') return null
  const record = last as Record<string, unknown>

  const renderer = record.continuationItemRenderer
  if (renderer && typeof renderer === 'object') {
    const rendererRecord = renderer as Record<string, unknown>
    const endpoint = rendererRecord.continuationEndpoint
    if (endpoint && typeof endpoint === 'object') {
      const endpointRecord = endpoint as Record<string, unknown>
      const command = endpointRecord.continuationCommand
      if (command && typeof command === 'object') {
        const token = (command as Record<string, unknown>).token
        if (typeof token === 'string' && token.length > 0) return token
      }

      const commands = endpointRecord.commandExecutorCommand
      if (commands && typeof commands === 'object') {
        const commandList = (commands as Record<string, unknown>).commands
        if (Array.isArray(commandList)) {
          for (const entry of commandList) {
            if (!entry || typeof entry !== 'object') continue
            const continuationCommand = (entry as Record<string, unknown>).continuationCommand
            if (!continuationCommand || typeof continuationCommand !== 'object') continue
            const request = (continuationCommand as Record<string, unknown>).request
            const token = (continuationCommand as Record<string, unknown>).token
            if (request === 'CONTINUATION_REQUEST_TYPE_BROWSE' && typeof token === 'string' && token) {
              return token
            }
          }
        }
      }
    }
  }

  return null
}

function extractAppendContinuationItems(response: unknown): unknown[] {
  const actions = deepFind(response, 'onResponseReceivedActions')
  if (!Array.isArray(actions)) return []

  const items: unknown[] = []
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue
    const append = (action as Record<string, unknown>).appendContinuationItemsAction
    if (!append || typeof append !== 'object') continue
    const continuationItems = (append as Record<string, unknown>).continuationItems
    if (Array.isArray(continuationItems)) {
      items.push(...continuationItems)
    }
  }

  return items
}

function tokenFromContinuations(continuations: unknown): string | null {
  if (!Array.isArray(continuations)) return null

  for (const entry of continuations) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    for (const key of ['nextContinuationData', 'reloadContinuationData']) {
      const data = record[key]
      if (!data || typeof data !== 'object') continue
      const token = (data as Record<string, unknown>).continuation
      if (typeof token === 'string' && token.length > 0) return token
    }
  }

  return null
}

function extractPlaylistVideoItems(response: unknown): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = []

  const collectFromContents = (contents: unknown): void => {
    if (!Array.isArray(contents)) return
    for (const entry of contents) {
      if (!entry || typeof entry !== 'object') continue
      const renderer = (entry as Record<string, unknown>).musicResponsiveListItemRenderer
      if (renderer && typeof renderer === 'object') {
        items.push(renderer as Record<string, unknown>)
      }
    }
  }

  const shelf = deepFind(response, 'musicPlaylistShelfRenderer')
  if (shelf && typeof shelf === 'object') {
    collectFromContents((shelf as Record<string, unknown>).contents)
    if (items.length > 0) return items
  }

  const shelfContinuation = deepFind(response, 'musicPlaylistShelfContinuation')
  if (shelfContinuation && typeof shelfContinuation === 'object') {
    collectFromContents((shelfContinuation as Record<string, unknown>).contents)
    if (items.length > 0) return items
  }

  walk(response, (node) => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if ('musicResponsiveListItemRenderer' in record) {
      items.push(record.musicResponsiveListItemRenderer as Record<string, unknown>)
    }
  })

  return items
}

function parsePlaylistVideoItem(item: Record<string, unknown>): PlaylistVideo | null {
  const videoIdFromNav = deepFind(item, 'videoId')
  let videoId = typeof videoIdFromNav === 'string' ? videoIdFromNav : null

  if (!videoId) {
    const thumbs = deepFind(item, 'thumbnails')
    if (Array.isArray(thumbs) && thumbs[0] && typeof thumbs[0] === 'object') {
      const url = (thumbs[0] as { url?: string }).url
      const match = typeof url === 'string' ? url.match(/\/vi\/([^/]+)\//) : null
      videoId = match?.[1] ?? null
    }
  }

  if (!videoId) return null

  const flexColumns = item.flexColumns
  const columnTexts: string[] = []
  if (Array.isArray(flexColumns)) {
    for (const column of flexColumns) {
      const text = extractText(column)
      if (text) columnTexts.push(text)
    }
  }

  let duration: number | null = null
  const fixedColumns = item.fixedColumns
  if (Array.isArray(fixedColumns)) {
    for (const column of fixedColumns) {
      const text = extractText(column)
      if (text && /(\d{1,2}:)?\d{1,2}:\d{2}/.test(text)) {
        duration = parseDuration(text)
        break
      }
    }
  }

  return {
    videoId,
    name: columnTexts[0] || 'Unknown Title',
    artist: { name: columnTexts[1] || 'Unknown Artist' },
    duration,
    thumbnails: extractThumbnails(item.thumbnail ?? item.thumbnails)
  }
}

function parseDuration(text: string): number | null {
  const parts = text.split(':').map((part) => Number(part))
  if (parts.some((part) => Number.isNaN(part))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function extractContinuation(response: unknown): string | null {
  const token = deepFind(response, 'continuation')
  return typeof token === 'string' ? token : null
}

function extractGridPlaylistItems(response: unknown): Array<{
  id: string
  title: string
  count: number
  thumbnails: Array<{ url: string; width: number; height: number }>
}> {
  const results: Array<{
    id: string
    title: string
    count: number
    thumbnails: Array<{ url: string; width: number; height: number }>
  }> = []

  walk(response, (node) => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>

    if ('musicTwoRowItemRenderer' in record) {
      const item = record.musicTwoRowItemRenderer as Record<string, unknown>
      const parsed = parsePlaylistCard(item)
      if (parsed) results.push(parsed)
    }

    if ('musicResponsiveListItemRenderer' in record) {
      const item = record.musicResponsiveListItemRenderer as Record<string, unknown>
      const parsed = parseResponsivePlaylist(item)
      if (parsed) results.push(parsed)
    }

    if ('musicNavigationButtonRenderer' in record) {
      const item = record.musicNavigationButtonRenderer as Record<string, unknown>
      const title = extractText(item.buttonText)
      const browseId = deepFind(item, 'browseId')
      const playlistId = typeof browseId === 'string' ? browseId : null
      if (!playlistId || !title || playlistId === 'FEmusic_liked_playlists') return
      results.push({ id: playlistId, title, count: 0, thumbnails: [] })
    }
  })

  const unique = new Map<string, (typeof results)[number]>()
  for (const item of results) {
    if (!unique.has(item.id)) unique.set(item.id, item)
  }
  return [...unique.values()]
}

function walk(node: unknown, visit: (node: unknown) => void): void {
  visit(node)
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  for (const value of Object.values(node)) walk(value, visit)
}

function deepFind(node: unknown, key: string): unknown {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = deepFind(child, key)
      if (found !== null && found !== undefined) return found
    }
    return null
  }
  const record = node as Record<string, unknown>
  if (key in record) return record[key]
  for (const value of Object.values(record)) {
    const found = deepFind(value, key)
    if (found !== null && found !== undefined) return found
  }
  return null
}

function normalizePlaylistId(id: string): string {
  if (id.startsWith('VL')) return id.slice(2)
  return id
}

function parsePlaylistCard(item: Record<string, unknown>): {
  id: string
  title: string
  count: number
  thumbnails: Array<{ url: string; width: number; height: number }>
} | null {
  const title = extractText(item.title)
  const subtitle = extractText(item.subtitle)
  const browseId = deepFind(item, 'browseId')
  const playlistId = typeof browseId === 'string' ? normalizePlaylistId(browseId) : null
  if (!playlistId || !title || !playlistId.startsWith('PL')) return null

  const countMatch = subtitle?.match(/(\d+)/)
  return {
    id: playlistId,
    title,
    count: countMatch ? Number(countMatch[1]) : 0,
    thumbnails: extractThumbnails(item.thumbnail ?? item.thumbnails)
  }
}

function parseResponsivePlaylist(item: Record<string, unknown>): {
  id: string
  title: string
  count: number
  thumbnails: Array<{ url: string; width: number; height: number }>
} | null {
  const playlistIdRaw =
    deepFind(item, 'playlistId') ??
    deepFind(item, 'browseId')
  const playlistId =
    typeof playlistIdRaw === 'string' ? normalizePlaylistId(playlistIdRaw) : null
  if (!playlistId || !playlistId.startsWith('PL')) return null

  const flexColumns = item.flexColumns
  const title =
    Array.isArray(flexColumns) && flexColumns[0]
      ? extractText((flexColumns[0] as Record<string, unknown>).musicResponsiveListItemFlexColumnRenderer)
      : extractText(item.title)

  if (!title) return null

  const subtitleColumn =
    Array.isArray(flexColumns) && flexColumns[1]
      ? extractText((flexColumns[1] as Record<string, unknown>).musicResponsiveListItemFlexColumnRenderer)
      : extractText(item.subtitle)
  const countMatch = subtitleColumn?.match(/(\d+)/)

  return {
    id: playlistId,
    title,
    count: countMatch ? Number(countMatch[1]) : 0,
    thumbnails: extractThumbnails(item.thumbnail ?? item.thumbnails)
  }
}

function extractText(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const record = node as Record<string, unknown>

  for (const key of [
    'musicResponsiveListItemFlexColumnRenderer',
    'musicItemFlexColumnRenderer',
    'musicResponsiveListItemFixedColumnRenderer',
    'musicItemFixedColumnRenderer'
  ]) {
    if (key in record) {
      const nested = extractText(record[key])
      if (nested) return nested
    }
  }

  if ('text' in record && record.text !== node) {
    const nested = extractText(record.text)
    if (nested) return nested
  }

  if (typeof record.simpleText === 'string') return record.simpleText
  if (Array.isArray(record.runs)) {
    return record.runs
      .map((run) => {
        if (!run || typeof run !== 'object') return ''
        const text = (run as Record<string, unknown>).text
        return typeof text === 'string' ? text : ''
      })
      .join('')
      .trim()
  }
  return null
}

function extractThumbnails(node: unknown): Array<{ url: string; width: number; height: number }> {
  const thumbnails = deepFind(node, 'thumbnails')
  if (!Array.isArray(thumbnails)) return []
  return thumbnails
    .filter((thumb) => thumb && typeof thumb === 'object' && typeof (thumb as { url?: string }).url === 'string')
    .map((thumb) => {
      const t = thumb as { url: string; width?: number; height?: number }
      return { url: t.url, width: t.width ?? 0, height: t.height ?? 0 }
    })
}

export const ytmusicService = new YTMusicService()
