import { BrowserWindow, safeStorage, session } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import {
  configureYtmusicClient,
  electronCookiesToApiHeader,
  hasAuthCookies,
  hasAuthCookiesInFile,
  parseNetscapeCookies,
  readCookieHeader,
  readYoutubeCookieHeader,
  refreshYtDlpCookiesFile,
  syncNetscapeCookiesToSession,
  writeNetscapeCookiesFromElectron,
  writeYtDlpCookiesFile,
  writeYtDlpCookiesFromParsed,
  YTM_LOGIN_PARTITION,
  type YtmCookieClient
} from './cookies'
import { getAuthJsonPath, getCookiesPath, getEncryptedCookiesPath } from './paths'

export { YTM_LOGIN_PARTITION as LOGIN_PARTITION } from './cookies'

export interface StoredAuth {
  cookieHeader: string
  accountName: string | null
}

function isRelevantCookie(cookie: Electron.Cookie): boolean {
  const domain = cookie.domain || ''
  return (
    domain.includes('youtube.com') || domain.includes('google.com') || domain.includes('youtu.be')
  )
}

function isIntermediateAuthUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return (
    lower.includes('accounts.google.com') ||
    lower.includes('google.com/signin') ||
    lower.includes('google.com/accountchooser') ||
    lower.includes('google.com/servicelogin') ||
    lower.includes('google.com/o/oauth2') ||
    lower.includes('youtube.com/signin') ||
    lower.includes('servicelogin') ||
    lower.includes('accountchooser') ||
    lower.includes('select_account') ||
    lower.includes('oauthchooseaccount') ||
    lower.includes('channel_switcher') ||
    lower.includes('switch_account') ||
    lower.includes('signinchooser')
  )
}

function isReadyForSessionCheck(url: string): boolean {
  if (!url.includes('music.youtube.com')) return false
  return !isIntermediateAuthUrl(url)
}

export class AuthService {
  private auth: StoredAuth | null = null

  private persistAuth(auth: StoredAuth): void {
    this.auth = auth
    writeFileSync(getAuthJsonPath(), JSON.stringify(auth, null, 2), 'utf-8')

    if (safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = safeStorage.encryptString(JSON.stringify(auth))
        writeFileSync(getEncryptedCookiesPath(), encrypted)
      } catch {
        // Fall back to auth.json only.
      }
    }
  }

  private persistAuthFromCookieHeader(
    cookieHeader: string,
    accountName: string | null = this.auth?.accountName ?? null
  ): void {
    if (!hasAuthCookies(cookieHeader)) return
    this.persistAuth({ cookieHeader, accountName })
  }

  private loadAuthFromDisk(): void {
    const candidates: StoredAuth[] = []

    if (existsSync(getAuthJsonPath())) {
      try {
        candidates.push(JSON.parse(readFileSync(getAuthJsonPath(), 'utf-8')) as StoredAuth)
      } catch {
        // Ignore invalid auth.json.
      }
    }

    const encPath = getEncryptedCookiesPath()
    if (existsSync(encPath) && safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = readFileSync(encPath)
        const decrypted = safeStorage.decryptString(encrypted)
        candidates.push(JSON.parse(decrypted) as StoredAuth)
      } catch {
        // Ignore invalid encrypted auth.
      }
    }

    for (const candidate of candidates) {
      if (candidate.cookieHeader && hasAuthCookies(candidate.cookieHeader)) {
        this.auth = candidate
        return
      }
    }

    const cookieHeader = readYoutubeCookieHeader() ?? readCookieHeader()
    if (cookieHeader && hasAuthCookies(cookieHeader)) {
      this.auth = { cookieHeader, accountName: null }
    }
  }

  async load(): Promise<void> {
    this.loadAuthFromDisk()

    if (this.auth?.cookieHeader) {
      writeFileSync(getCookiesPath(), this.toCookiesTxt(this.auth.cookieHeader), 'utf-8')
      this.persistAuth(this.auth)
    }

    if (existsSync(getCookiesPath())) {
      await syncNetscapeCookiesToSession()
      await refreshYtDlpCookiesFile()
    }
  }

  getStatus(): { isAuthenticated: boolean; accountName: string | null } {
    const isAuthenticated = Boolean(
      (this.auth?.cookieHeader && hasAuthCookies(this.auth.cookieHeader)) ||
        hasAuthCookiesInFile()
    )
    return {
      isAuthenticated,
      accountName: this.auth?.accountName ?? null
    }
  }

  getCookieHeader(): string | null {
    return readYoutubeCookieHeader() ?? readCookieHeader() ?? this.auth?.cookieHeader ?? null
  }

  async getApiCookieHeader(): Promise<string | null> {
    let header: string | null = null

    if (this.auth?.cookieHeader && hasAuthCookies(this.auth.cookieHeader)) {
      header = this.auth.cookieHeader
    } else {
      const fileHeader = readYoutubeCookieHeader() ?? readCookieHeader()
      if (fileHeader && hasAuthCookies(fileHeader)) {
        header = fileHeader
        this.persistAuthFromCookieHeader(fileHeader)
      }
    }

    if (!header) {
      const loginSession = session.fromPartition(YTM_LOGIN_PARTITION)
      const allCookies = await loginSession.cookies.get({})
      const relevant = allCookies.filter(isRelevantCookie)

      if (relevant.length > 0) {
        const partitionHeader = electronCookiesToApiHeader(relevant)
        if (hasAuthCookies(partitionHeader)) {
          header = partitionHeader
          writeNetscapeCookiesFromElectron(relevant)
          this.persistAuthFromCookieHeader(partitionHeader)
        }
      }
    }

    if (!header) return null

    writeFileSync(getCookiesPath(), this.toCookiesTxt(header), 'utf-8')
    await syncNetscapeCookiesToSession()
    await refreshYtDlpCookiesFile()
    return header
  }

  private toCookiesTxt(cookieHeader: string): string {
    const cookies = cookieHeader
      .split('; ')
      .map((pair) => {
        const idx = pair.indexOf('=')
        if (idx === -1) return null
        return { name: pair.slice(0, idx), value: pair.slice(idx + 1) }
      })
      .filter(Boolean) as Array<{ name: string; value: string }>

    const lines = ['# Netscape HTTP Cookie File', '# This file was generated by ytm-synk']
    for (const c of cookies) {
      lines.push(`.youtube.com\tTRUE\t/\tTRUE\t0\t${c.name}\t${c.value}`)
    }
    return `${lines.join('\n')}\n`
  }

  async login(): Promise<{ success: boolean; accountName: string | null; error?: string }> {
    await session.fromPartition(YTM_LOGIN_PARTITION).clearStorageData()

    return new Promise((resolve) => {
      const loginWindow = new BrowserWindow({
        width: 900,
        height: 700,
        autoHideMenuBar: true,
        title: 'Sign in to YouTube Music — choose a channel, then wait for your library',
        webPreferences: {
          partition: YTM_LOGIN_PARTITION,
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      const loginSession = session.fromPartition(YTM_LOGIN_PARTITION)
      let resolved = false
      let completing = false
      let pollTimer: NodeJS.Timeout | null = null

      const cleanup = (): void => {
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
      }

      const saveAuth = async (
        cookies: Electron.Cookie[]
      ): Promise<{ accountName: string | null }> => {
        writeYtDlpCookiesFile(
          cookies.filter((cookie) => (cookie.domain || '').includes('youtube.com'))
        )
        await syncNetscapeCookiesToSession()
        const apiHeader =
          readYoutubeCookieHeader(getCookiesPath()) ?? electronCookiesToApiHeader(cookies)

        if (!hasAuthCookies(apiHeader)) {
          throw new Error('Login incomplete. Valid YouTube session cookies were not found.')
        }

        this.persistAuthFromCookieHeader(apiHeader)

        let accountName: string | null = null
        try {
          const YTMusic = (await import('ytmusic-api')).default
          const client = new YTMusic() as unknown as YtmCookieClient
          await client.initialize({ cookies: apiHeader })
          configureYtmusicClient(client, apiHeader)
          accountName = await this.fetchAccountInfo(client)
          if (accountName) {
            this.persistAuthFromCookieHeader(apiHeader, accountName)
          }
        } catch {
          // Cookies are saved; account name is optional.
        }

        return { accountName }
      }

      const tryComplete = async (mode: 'auto' | 'manual'): Promise<void> => {
        if (resolved || completing) return

        const url = loginWindow.isDestroyed() ? '' : loginWindow.webContents.getURL()
        if (mode === 'auto' && !isReadyForSessionCheck(url)) {
          return
        }

        completing = true
        try {
          const allCookies = await loginSession.cookies.get({})
          const relevant = allCookies.filter(isRelevantCookie)

          if (!hasAuthCookies(electronCookiesToApiHeader(relevant))) {
            if (mode === 'manual') {
              resolved = true
              cleanup()
              resolve({
                success: false,
                accountName: null,
                error:
                  'Login incomplete. Sign in with Google, choose your channel, wait until your library appears, then close this window.'
              })
            }
            return
          }

          const { accountName } = await saveAuth(relevant)
          resolved = true
          cleanup()
          if (!loginWindow.isDestroyed()) loginWindow.close()
          resolve({ success: true, accountName })
        } catch (err) {
          if (mode === 'manual') {
            resolved = true
            cleanup()
            resolve({
              success: false,
              accountName: null,
              error: err instanceof Error ? err.message : 'Failed to save cookies'
            })
            return
          }

          // Auto mode: cookies may exist before channel selection finishes.
          // Keep the login window open and keep polling.
        } finally {
          completing = false
        }
      }

      loginWindow.on('closed', () => {
        if (!resolved) void tryComplete('manual')
        else cleanup()
      })

      pollTimer = setInterval(() => {
        if (loginWindow.isDestroyed() || resolved) return
        const url = loginWindow.webContents.getURL()
        if (isReadyForSessionCheck(url)) {
          void tryComplete('auto')
        }
      }, 3000)

      loginWindow.webContents.on('did-navigate', (_event, url) => {
        if (isReadyForSessionCheck(url)) {
          setTimeout(() => void tryComplete('auto'), 3000)
        }
      })

      loginWindow.webContents.on('did-navigate-in-page', (_event, url) => {
        if (isReadyForSessionCheck(url)) {
          setTimeout(() => void tryComplete('auto'), 3000)
        }
      })

      loginWindow.webContents.on('did-finish-load', () => {
        const url = loginWindow.webContents.getURL()
        if (isReadyForSessionCheck(url)) {
          setTimeout(() => void tryComplete('auto'), 3000)
        }
      })

      loginWindow.loadURL('https://music.youtube.com')
    })
  }

  async importCookiesFile(
    filePath: string
  ): Promise<{ success: boolean; accountName: string | null; error?: string }> {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const cookiePairs: string[] = []

      for (const line of content.split('\n')) {
        if (!line || line.startsWith('#')) continue
        const parts = line.split('\t')
        if (parts.length >= 7) cookiePairs.push(`${parts[5]}=${parts[6]}`)
      }

      if (cookiePairs.length === 0) {
        return { success: false, accountName: null, error: 'No cookies found in file' }
      }

      const cookieHeader = cookiePairs.join('; ')
      if (!hasAuthCookies(cookieHeader)) {
        return {
          success: false,
          accountName: null,
          error: 'Imported cookies do not contain a valid YouTube Music session.'
        }
      }

      writeYtDlpCookiesFromParsed(parseNetscapeCookies(content))
      await syncNetscapeCookiesToSession()
      const youtubeHeader = readYoutubeCookieHeader(getCookiesPath())
      if (!youtubeHeader) {
        return { success: false, accountName: null, error: 'No youtube.com cookies found in file' }
      }

      this.persistAuthFromCookieHeader(youtubeHeader)

      let accountName: string | null = null
      try {
        const YTMusic = (await import('ytmusic-api')).default
        const client = new YTMusic() as unknown as YtmCookieClient
        await client.initialize({ cookies: youtubeHeader })
        configureYtmusicClient(client, youtubeHeader)
        accountName = await this.fetchAccountInfo(client)
        if (accountName) {
          this.persistAuthFromCookieHeader(youtubeHeader, accountName)
        }
      } catch {
        // Imported cookies are persisted even if account lookup fails.
      }

      return { success: true, accountName }
    } catch (err) {
      return {
        success: false,
        accountName: null,
        error: err instanceof Error ? err.message : 'Failed to import cookies'
      }
    }
  }

  logout(): void {
    this.auth = null
    if (existsSync(getEncryptedCookiesPath())) unlinkSync(getEncryptedCookiesPath())
    if (existsSync(getAuthJsonPath())) unlinkSync(getAuthJsonPath())
    if (existsSync(getCookiesPath())) unlinkSync(getCookiesPath())
    void session.fromPartition(YTM_LOGIN_PARTITION).clearStorageData()
  }

  private async fetchAccountInfo(client: YtmCookieClient): Promise<string | null> {
    const response = await client.constructRequest('account/account_menu', {})
    const record = response as Record<string, unknown>
    const accountName = deepFindString(record, 'accountName')
    if (accountName && !accountName.toLowerCase().includes('premium')) return accountName
    const channelHandle = deepFindString(record, 'channelHandle')
    return channelHandle
  }
}

function deepFindString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindString(item, key)
      if (found) return found
    }
    return null
  }
  const record = obj as Record<string, unknown>
  if (key in record && typeof record[key] === 'string') return record[key]
  if ('runs' in record && Array.isArray(record.runs) && record.runs[0] && typeof record.runs[0] === 'object') {
    const run = record.runs[0] as Record<string, unknown>
    if (typeof run.text === 'string') return run.text
  }
  for (const value of Object.values(record)) {
    const found = deepFindString(value, key)
    if (found) return found
  }
  return null
}

export const authService = new AuthService()
