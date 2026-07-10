import YTMusic from 'ytmusic-api'
import type { PlaylistListResult, PlaylistSummary, RemoteTrack } from '../../shared/types'
import { authService } from './auth'
import {
  configureYtmusicClient,
  parsePlaylistId,
  syncNetscapeCookiesToSession,
  type YtmCookieClient
} from './cookies'
import { database } from './database'
import { logger } from './logger'

type YtmClient = YtmCookieClient & {
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

    try {
      const client = await this.freshClient()
      const meta = await fetchPlaylistMeta(client, playlistId)
      const id = normalizePlaylistId(meta.playlistId)
      const config = database.toggleSelectedPlaylist(id, true)
      database.ensurePlaylistIndexStub(id, meta.name)

      const summary: PlaylistSummary = {
        id,
        title: meta.name,
        count: meta.videoCount,
        thumbnails: meta.thumbnails,
        selected: config.selectedPlaylists.some((entry) => normalizePlaylistId(entry) === id),
        lastSyncedAt: database.getPlaylistIndex(id)?.lastSyncedAt ?? null,
        manual: true
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

  /** Always rebuild the client so auth header/cookie changes apply immediately. */
  private async freshClient(): Promise<YtmClient> {
    this.client = null
    return this.ensureClient()
  }

  async getLibraryPlaylists(): Promise<PlaylistListResult> {
    const config = database.getConfig()
    const merged = new Map<string, PlaylistSummary>()
    let libraryError: string | undefined
    const manualIds = new Set(
      (config.manualPlaylists ?? []).map((playlist) => normalizePlaylistId(playlist.id))
    )

    for (const playlist of database.getManualPlaylistSummaries()) {
      const id = normalizePlaylistId(playlist.id)
      merged.set(id, { ...playlist, id, manual: true })
    }

    const selectedIds = new Set(config.selectedPlaylists.map((id) => normalizePlaylistId(id)))

    const mergeLibraryItem = (item: {
      id: string
      title: string
      count: number
      thumbnails: Array<{ url: string; width: number; height: number }>
    }): void => {
      // Library browse only lists playlists — never auto-select for sync.
      const id = normalizePlaylistId(item.id)
      const local = database.getPlaylistIndex(id) ?? database.getPlaylistIndex(`VL${id}`)
      merged.set(id, {
        id,
        title: item.title,
        count: item.count,
        thumbnails: item.thumbnails,
        selected: selectedIds.has(id),
        lastSyncedAt: local?.lastSyncedAt ?? null,
        manual: false
      })
    }

    try {
      const client = await this.freshClient()

      let continuation: string | null = null
      let data = await client.constructRequest('browse', { browseId: 'FEmusic_liked_playlists' })
      let pages = 0
      let parsedLibraryItems = 0

      const collect = (response: unknown): void => {
        const items = extractGridPlaylistItems(response)
        parsedLibraryItems += items.length
        for (const item of items) {
          mergeLibraryItem(item)
        }
        continuation = extractLibraryContinuation(response)
      }

      collect(data)
      while (continuation && pages < 50) {
        pages++
        data = await client.constructRequest('browse', { browseId: 'FEmusic_liked_playlists' }, {
          continuation
        })
        collect(data)
      }

      if (parsedLibraryItems === 0) {
        const diagnosis = diagnoseLibraryBrowseResponse(data)
        logger.info(
          `Library browse returned 0 playlists (${diagnosis}). Manual playlists: ${merged.size}.`
        )
        if (diagnosis.includes('guest') || diagnosis.includes('signed-out')) {
          libraryError =
            'YouTube Music returned a signed-out library page. Sign out and sign in again, then wait until your library loads before closing the login window.'
        } else {
          libraryError = `Library browse returned no playlists (${diagnosis}). Try signing out and back in.`
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load library playlists'
      libraryError = message
      logger.error(`Library playlist browse failed: ${message}`)
    }

    for (const playlistId of config.selectedPlaylists) {
      const id = normalizePlaylistId(playlistId)
      if (merged.has(id)) continue

      const index = database.getPlaylistIndex(id) ?? database.getPlaylistIndex(playlistId)
      if (index) {
        merged.set(id, {
          id,
          title: index.name,
          count: Object.keys(index.tracks).length,
          thumbnails: [],
          selected: true,
          lastSyncedAt: index.lastSyncedAt,
          manual: manualIds.has(id)
        })
      }
    }

    for (const playlist of merged.values()) {
      playlist.selected = selectedIds.has(normalizePlaylistId(playlist.id))
    }

    return {
      playlists: [...merged.values()].sort((a, b) => a.title.localeCompare(b.title)),
      libraryError
    }
  }

  async getPlaylistTracks(playlistId: string): Promise<{ name: string; tracks: RemoteTrack[] }> {
    const client = await this.ensureClient()
    const meta = await fetchPlaylistMeta(client, playlistId)
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

type PlaylistMeta = {
  playlistId: string
  name: string
  videoCount: number
  thumbnails: Array<{ url: string; width: number; height: number }>
}

/** YouTube Music playlist browse ids use a VL prefix for PL/OLAK (and similar) lists. */
function toPlaylistBrowseId(playlistId: string): string {
  const id = playlistId.trim()
  if (!id) return id
  if (id.startsWith('VL') || id === 'LM' || id.startsWith('FE')) return id
  if (id.startsWith('PL') || id.startsWith('OLAK') || id.startsWith('RD')) return `VL${id}`
  return id
}

/** Browse playlist metadata without ytmusic-api's fragile PlaylistParser. */
async function fetchPlaylistMeta(client: YtmClient, playlistId: string): Promise<PlaylistMeta> {
  const browseId = toPlaylistBrowseId(playlistId)
  const response = await client.constructRequest('browse', { browseId })
  const id = normalizePlaylistId(playlistId)
  const name =
    extractPlaylistTitle(response) ?? extractAlbumTitleFromTracks(response)
  const videoCount =
    extractPlaylistVideoCount(response) ?? countPlaylistItemsOnPage(response) ?? 0
  const hasTracks = videoCount > 0 || findPlaylistShelfRenderer(response) !== null

  if (!name) {
    const diagnosis = diagnoseLibraryBrowseResponse(response)
    logger.error(
      `Playlist meta title missing for ${browseId} (diagnosis=${diagnosis}, hasTracks=${hasTracks}, bytes=${JSON.stringify(response).length})`
    )
    if (hasTracks) {
      return {
        playlistId: id,
        name: id,
        videoCount,
        thumbnails: extractThumbnails(response)
      }
    }
    if (diagnosis.includes('guest') || diagnosis.includes('signed-out')) {
      throw new Error('YouTube Music returned a signed-out page for this playlist')
    }
    throw new Error('Could not read playlist details from YouTube Music')
  }

  return {
    playlistId: id,
    name,
    videoCount,
    thumbnails: extractThumbnails(response)
  }
}

function extractPlaylistTitle(response: unknown): string | null {
  for (const key of [
    'musicResponsiveHeaderRenderer',
    'musicDetailHeaderRenderer',
    'musicVisualHeaderRenderer',
    'musicImmersiveHeaderRenderer'
  ]) {
    const header = deepFind(response, key)
    if (!header || typeof header !== 'object') continue
    const record = header as Record<string, unknown>
    const title =
      extractText(record.title) ??
      extractText(record.fullscreenTitle) ??
      extractText(record.headline)
    if (title) return title
  }

  const editable = deepFind(response, 'musicEditablePlaylistDetailHeaderRenderer')
  if (editable && typeof editable === 'object') {
    const header = (editable as Record<string, unknown>).header
    if (header && typeof header === 'object') {
      for (const key of ['musicDetailHeaderRenderer', 'musicResponsiveHeaderRenderer']) {
        const detail = (header as Record<string, unknown>)[key]
        if (!detail || typeof detail !== 'object') continue
        const title = extractText((detail as Record<string, unknown>).title)
        if (title) return title
      }
    }
  }

  // Same path ytmusic-api uses: tabs → title → text
  const fromTabs = traverseFirstString(response, 'tabs', 'title', 'text')
  if (fromTabs) return fromTabs

  const microformat = deepFind(response, 'microformatDataRenderer')
  if (microformat && typeof microformat === 'object') {
    const title = (microformat as Record<string, unknown>).title
    if (typeof title === 'string' && title.trim()) return title.trim()
  }

  return null
}

/** Album playlists (OLAK…) often omit a page header; album name is on track rows. */
function extractAlbumTitleFromTracks(response: unknown): string | null {
  const titles = new Set<string>()

  walk(response, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    const record = node as Record<string, unknown>
    const runs = record.runs
    if (!Array.isArray(runs)) return

    for (const run of runs) {
      if (!run || typeof run !== 'object') continue
      const runRecord = run as Record<string, unknown>
      if (typeof runRecord.text !== 'string' || !runRecord.text.trim()) continue
      if (!isAlbumBrowseEndpoint(runRecord.navigationEndpoint)) continue
      titles.add(runRecord.text.trim())
    }
  })

  const [first] = titles
  return first ?? null
}

function isAlbumBrowseEndpoint(endpoint: unknown): boolean {
  if (!endpoint || typeof endpoint !== 'object') return false
  const browse = (endpoint as Record<string, unknown>).browseEndpoint
  if (!browse || typeof browse !== 'object') return false
  const configs = (browse as Record<string, unknown>).browseEndpointContextSupportedConfigs
  if (!configs || typeof configs !== 'object') return false
  const musicConfig = (configs as Record<string, unknown>).browseEndpointContextMusicConfig
  if (!musicConfig || typeof musicConfig !== 'object') return false
  return (musicConfig as Record<string, unknown>).pageType === 'MUSIC_PAGE_TYPE_ALBUM'
}

/**
 * Collect nested values by successive key lookups (ytmusic-api traverse style).
 * Returns the first non-empty string found at the final key.
 */
function traverseFirstString(data: unknown, ...keys: string[]): string | null {
  const again = (node: unknown, key: string): unknown[] => {
    const results: unknown[] = []
    if (!node || typeof node !== 'object') return results
    if (Array.isArray(node)) {
      for (const child of node) results.push(...again(child, key))
      return results
    }
    const record = node as Record<string, unknown>
    if (key in record) results.push(record[key])
    for (const value of Object.values(record)) {
      results.push(...again(value, key))
    }
    return results
  }

  let values: unknown[] = [data]
  for (const key of keys) {
    values = values.flatMap((value) => again(value, key))
  }

  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    const text = extractText(value)
    if (text) return text
  }
  return null
}

function extractPlaylistVideoCount(response: unknown): number | null {
  const texts: string[] = []

  const collectText = (node: unknown): void => {
    const text = extractText(node)
    if (text) texts.push(text)
    if (!node || typeof node !== 'object') return
    const runs = (node as Record<string, unknown>).runs
    if (!Array.isArray(runs)) return
    for (const run of runs) {
      if (!run || typeof run !== 'object') continue
      const value = (run as Record<string, unknown>).text
      if (typeof value === 'string' && value.trim()) texts.push(value.trim())
    }
  }

  for (const key of ['secondSubtitle', 'subtitle']) {
    collectText(deepFind(response, key))
  }

  for (const text of texts) {
    const match = text.match(/([\d,]+)\s*(?:songs?|tracks?|videos?)/i)
    if (match) return Number(match[1].replace(/,/g, ''))
  }

  return null
}

function countPlaylistItemsOnPage(response: unknown): number | null {
  const shelf = findPlaylistShelfRenderer(response)
  if (!shelf || !Array.isArray(shelf.contents)) return null
  let count = 0
  for (const entry of shelf.contents) {
    if (!entry || typeof entry !== 'object') continue
    if ('musicResponsiveListItemRenderer' in (entry as Record<string, unknown>)) count++
  }
  return count > 0 ? count : null
}

async function fetchAllPlaylistVideos(
  client: YtmClient,
  playlistId: string
): Promise<PlaylistVideo[]> {
  const browseId = toPlaylistBrowseId(playlistId)

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

function parseDuration(text: string | null | undefined): number | null {
  if (!text) return null
  const parts = text.split(':').map((part) => Number(part))
  if (parts.some((part) => Number.isNaN(part))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function diagnoseLibraryBrowseResponse(response: unknown): string {
  const payload = JSON.stringify(response ?? {})
  const parts: string[] = []

  if (
    payload.includes('Looking for what you') ||
    payload.includes('SIGN_IN') ||
    payload.includes('"logged_in","value":"0"') ||
    payload.includes('"key":"logged_in","value":"0"')
  ) {
    parts.push('signed-out')
  } else if (
    payload.includes('"logged_in","value":"1"') ||
    payload.includes('"key":"logged_in","value":"1"')
  ) {
    parts.push('logged-in')
  }

  let twoRow = 0
  let responsive = 0
  let navButton = 0
  let grid = 0
  let playlistPage = 0
  const sampleIds: string[] = []

  walk(response, (node) => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if ('musicTwoRowItemRenderer' in record) twoRow++
    if ('musicResponsiveListItemRenderer' in record) responsive++
    if ('musicNavigationButtonRenderer' in record) navButton++
    if ('gridRenderer' in record) grid++
    if (record.pageType === 'MUSIC_PAGE_TYPE_PLAYLIST') playlistPage++

    if ('browseId' in record && typeof record.browseId === 'string' && sampleIds.length < 8) {
      sampleIds.push(record.browseId.slice(0, 24))
    }
  })

  parts.push(`twoRow=${twoRow}`)
  parts.push(`responsive=${responsive}`)
  parts.push(`navButton=${navButton}`)
  parts.push(`grid=${grid}`)
  parts.push(`playlistPage=${playlistPage}`)
  if (sampleIds.length > 0) parts.push(`ids=${sampleIds.join(',')}`)
  parts.push(`bytes=${payload.length}`)
  return parts.join(' ')
}

function extractLibraryContinuation(response: unknown): string | null {
  const grid = deepFind(response, 'gridRenderer')
  if (grid && typeof grid === 'object') {
    const token = tokenFromContinuations((grid as Record<string, unknown>).continuations)
    if (token) return token
  }

  const gridContinuation = deepFind(response, 'gridContinuation')
  if (gridContinuation && typeof gridContinuation === 'object') {
    const token = tokenFromContinuations((gridContinuation as Record<string, unknown>).continuations)
    if (token) return token
  }

  const contContents = deepFind(response, 'continuationContents')
  if (contContents && typeof contContents === 'object') {
    const nested = (contContents as Record<string, unknown>).gridContinuation
    if (nested && typeof nested === 'object') {
      const token = tokenFromContinuations((nested as Record<string, unknown>).continuations)
      if (token) return token
    }
  }

  return null
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
      const browseId = extractBrowseIdFromEndpoint(item.navigationEndpoint) ?? deepFind(item, 'browseId')
      const playlistId =
        typeof browseId === 'string' ? normalizePlaylistId(browseId) : null
      if (!playlistId || !title || !isLibraryPlaylistId(playlistId)) return
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

function isLibraryPlaylistId(id: string): boolean {
  return /^(PL|LM|OLAK)/.test(id)
}

function extractBrowseIdFromEndpoint(endpoint: unknown): string | null {
  if (!endpoint || typeof endpoint !== 'object') return null
  const browse = (endpoint as Record<string, unknown>).browseEndpoint
  if (!browse || typeof browse !== 'object') return null
  const browseId = (browse as Record<string, unknown>).browseId
  return typeof browseId === 'string' ? browseId : null
}

function extractPlaylistBrowseId(item: Record<string, unknown>): string | null {
  const title = item.title
  if (title && typeof title === 'object') {
    const runs = (title as Record<string, unknown>).runs
    if (Array.isArray(runs)) {
      for (const run of runs) {
        if (!run || typeof run !== 'object') continue
        const browseId = extractBrowseIdFromEndpoint(
          (run as Record<string, unknown>).navigationEndpoint
        )
        if (browseId) return browseId
      }
    }
  }

  const topLevel = extractBrowseIdFromEndpoint(item.navigationEndpoint)
  if (topLevel) return topLevel

  const playlistId = item.playlistId
  if (typeof playlistId === 'string') return playlistId

  return null
}

function parsePlaylistCard(item: Record<string, unknown>): {
  id: string
  title: string
  count: number
  thumbnails: Array<{ url: string; width: number; height: number }>
} | null {
  const title = extractText(item.title)
  const subtitle = extractText(item.subtitle)
  const browseId = extractPlaylistBrowseId(item)
  const playlistId = browseId ? normalizePlaylistId(browseId) : null
  if (!playlistId || !title || !isLibraryPlaylistId(playlistId)) return null

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
  const browseId = extractPlaylistBrowseId(item)
  const playlistId = browseId ? normalizePlaylistId(browseId) : null
  if (!playlistId || !isLibraryPlaylistId(playlistId)) return null

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
  if (typeof node === 'string') {
    const trimmed = node.trim()
    return trimmed ? trimmed : null
  }
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
    if (typeof record.text === 'string') {
      const trimmed = record.text.trim()
      if (trimmed) return trimmed
    } else {
      const nested = extractText(record.text)
      if (nested) return nested
    }
  }

  if (typeof record.content === 'string') {
    const trimmed = record.content.trim()
    if (trimmed) return trimmed
  }

  if (typeof record.label === 'string') {
    const trimmed = record.label.trim()
    if (trimmed) return trimmed
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
