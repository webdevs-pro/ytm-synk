import { useEffect, useState } from 'react'
import type { AppConfig } from '../../../shared/types'

export function SettingsPage(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [auth, setAuth] = useState<{ isAuthenticated: boolean; accountName: string | null } | null>(
    null
  )
  const [downloader, setDownloader] = useState<{
    version: string | null
    ytdlpExists: boolean
    ffmpegExists: boolean
    jsRuntimeKind: 'deno' | 'node' | null
    jsRuntimeExists: boolean
  } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    const [cfg, status, info] = await Promise.all([
      window.api.settings.get(),
      window.api.auth.status(),
      window.api.downloader.info()
    ])
    setConfig(cfg)
    setAuth(status)
    setDownloader({
      version: info.version,
      ytdlpExists: info.ytdlpExists,
      ffmpegExists: info.ffmpegExists,
      jsRuntimeKind: info.jsRuntimeKind,
      jsRuntimeExists: info.jsRuntimeExists
    })
  }

  useEffect(() => {
    void load()
  }, [])

  const pickMusicRoot = async (): Promise<void> => {
    const folder = await window.api.settings.pickMusicRoot()
    if (!folder) return
    const next = await window.api.settings.set({ musicRoot: folder })
    setConfig(next)
    setMessage(`Music folder set to ${folder}`)
  }

  const login = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const result = await window.api.auth.login()
    setBusy(false)
    if (result.success) {
      setMessage(`Signed in${result.accountName ? ` as ${result.accountName}` : ''}`)
      await load()
    } else {
      setMessage(result.error || 'Login failed')
    }
  }

  const importCookies = async (): Promise<void> => {
    const file = await window.api.settings.pickCookiesFile()
    if (!file) return
    setBusy(true)
    const result = await window.api.auth.importCookies(file)
    setBusy(false)
    if (result.success) {
      setMessage('Cookies imported successfully')
      await load()
    } else {
      setMessage(result.error || 'Failed to import cookies')
    }
  }

  const logout = async (): Promise<void> => {
    await window.api.auth.logout()
    setMessage('Signed out')
    await load()
  }

  const updateYtDlp = async (): Promise<void> => {
    setBusy(true)
    const info = await window.api.downloader.update()
    setBusy(false)
    setDownloader({
      version: info.version,
      ytdlpExists: info.ytdlpExists,
      ffmpegExists: info.ffmpegExists,
      jsRuntimeKind: info.jsRuntimeKind,
      jsRuntimeExists: info.jsRuntimeExists
    })
    setMessage(`yt-dlp updated to ${info.version || 'latest'}`)
  }

  if (!config) return <div className="page">Loading settings...</div>

  return (
    <div className="page">
      <h2>Settings</h2>

      <section className="card">
        <h3>Music folder</h3>
        <p className="muted">Downloaded playlists are saved into subfolders here.</p>
        <div className="row">
          <code className="path">{config.musicRoot || 'Not set'}</code>
          <button onClick={() => void pickMusicRoot()}>Choose folder</button>
        </div>
      </section>

      <section className="card">
        <h3>YouTube Music account</h3>
        <p className="muted">
          {auth?.isAuthenticated
            ? `Signed in${auth.accountName ? ` as ${auth.accountName}` : ''}.`
            : 'Not signed in.'}{' '}
          A browser window will open. Sign in with Google, wait until your library loads, then close
          that window. You can also import a cookies.txt file exported from your browser.
        </p>
        <div className="row">
          <button disabled={busy} onClick={() => void login()}>
            Sign in
          </button>
          <button disabled={busy} onClick={() => void importCookies()}>
            Import cookies.txt
          </button>
          <button disabled={busy || !auth?.isAuthenticated} onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </section>

      <section className="card">
        <h3>Download tools</h3>
        <p className="muted">
          yt-dlp: {downloader?.ytdlpExists ? downloader.version || 'installed' : 'missing'}
          <br />
          ffmpeg: {downloader?.ffmpegExists ? 'installed' : 'missing'}
          <br />
          JS runtime:{' '}
          {downloader?.jsRuntimeExists
            ? downloader.jsRuntimeKind || 'installed'
            : 'missing (install Node.js or run npm run download-binaries)'}
        </p>
        <div className="row">
          <button disabled={busy} onClick={() => void updateYtDlp()}>
            Update yt-dlp
          </button>
          <button onClick={() => void window.api.settings.openLogs()}>Open logs folder</button>
        </div>
      </section>

      <section className="card">
        <h3>Download quality</h3>
        <select
          value={config.downloadQuality}
          onChange={async (e) => {
            const next = await window.api.settings.set({ downloadQuality: e.target.value })
            setConfig(next)
          }}
        >
          <option value="best">Best available</option>
          <option value="128">128 kbps</option>
          <option value="192">192 kbps</option>
          <option value="256">256 kbps</option>
          <option value="320">320 kbps</option>
        </select>
      </section>

      {message ? <div className="banner">{message}</div> : null}
    </div>
  )
}
