import { useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import type { AppConfig, AppUpdateStatus } from '../../../shared/types'

function updateStatusText(status: AppUpdateStatus | null): string {
  if (!status) return 'Checking update status...'
  switch (status.state) {
    case 'checking':
      return 'Checking for updates...'
    case 'upToDate':
      return 'You are up to date.'
    case 'available':
      return `Update ${status.availableVersion} is available. Downloading...`
    case 'downloading':
      return `Downloading update ${status.availableVersion || ''} (${Math.round(status.percent ?? 0)}%)...`
    case 'downloaded':
      return `Update ${status.availableVersion} downloaded. Restart to install.`
    case 'unavailable':
      return status.message || 'Updates are only available in the installed app.'
    case 'error':
      return status.message || 'Update check failed.'
    default:
      return 'Ready to check for updates.'
  }
}

export function SettingsPage(): React.JSX.Element {
  const { toast } = useToast()
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
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const load = async (): Promise<void> => {
    const [cfg, status, info, updater] = await Promise.all([
      window.api.settings.get(),
      window.api.auth.status(),
      window.api.downloader.info(),
      window.api.updater.getStatus()
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
    setUpdateStatus(updater)
  }

  useEffect(() => {
    void load()
    return window.api.updater.onStatus(setUpdateStatus)
  }, [])

  const pickMusicRoot = async (): Promise<void> => {
    const folder = await window.api.settings.pickMusicRoot()
    if (!folder) return
    const next = await window.api.settings.set({ musicRoot: folder })
    setConfig(next)
    toast({
      title: 'Music folder updated',
      description: folder,
      variant: 'success'
    })
  }

  const login = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.auth.login()
    setBusy(false)
    if (result.success) {
      toast({
        title: 'Signed in',
        description: result.accountName ? `as ${result.accountName}` : undefined,
        variant: 'success'
      })
      await load()
    } else {
      toast({
        title: 'Sign in failed',
        description: result.error || 'Login failed',
        variant: 'error'
      })
    }
  }

  const importCookies = async (): Promise<void> => {
    const file = await window.api.settings.pickCookiesFile()
    if (!file) return
    setBusy(true)
    const result = await window.api.auth.importCookies(file)
    setBusy(false)
    if (result.success) {
      toast({ title: 'Cookies imported', variant: 'success' })
      await load()
    } else {
      toast({
        title: 'Import failed',
        description: result.error || 'Failed to import cookies',
        variant: 'error'
      })
    }
  }

  const logout = async (): Promise<void> => {
    await window.api.auth.logout()
    toast({ title: 'Signed out', variant: 'info' })
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
    toast({
      title: 'yt-dlp updated',
      description: info.version || 'latest',
      variant: 'success'
    })
  }

  const checkForUpdates = async (): Promise<void> => {
    setCheckingUpdate(true)
    try {
      const status = await window.api.updater.check()
      setUpdateStatus(status)
      if (status.state === 'upToDate') {
        toast({
          title: 'You are up to date',
          description: `Current version: v${status.currentVersion}`,
          variant: 'success'
        })
      } else if (status.state === 'unavailable') {
        toast({
          title: 'Updates unavailable',
          description: status.message || 'Updates are only available in the installed app.',
          variant: 'warning'
        })
      }
    } finally {
      setCheckingUpdate(false)
    }
  }

  const installUpdate = async (): Promise<void> => {
    toast({ title: 'Restarting to install update…', variant: 'info' })
    await window.api.updater.install()
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
        <h3>App updates</h3>
        <p className="muted">
          Current version: {updateStatus?.currentVersion || '…'}
          <br />
          {updateStatusText(updateStatus)}
        </p>
        <div className="row">
          <button
            disabled={busy || checkingUpdate || updateStatus?.state === 'downloading'}
            onClick={() => void checkForUpdates()}
          >
            {checkingUpdate || updateStatus?.state === 'checking'
              ? 'Checking...'
              : 'Check for updates'}
          </button>
          {updateStatus?.state === 'downloaded' ? (
            <button disabled={busy} onClick={() => void installUpdate()}>
              Restart and install
            </button>
          ) : null}
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
        <p className="muted">
          Sync runs write files like <code>sync-YYYYMMDD-HHMMSS.log</code>. App events go to{' '}
          <code>app-YYYY-MM-DD.log</code>.
        </p>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <label htmlFor="log-retention">Keep logs for</label>
          <input
            id="log-retention"
            className="text-input"
            style={{ flex: '0 0 5rem', minWidth: '5rem' }}
            type="number"
            min={1}
            max={365}
            defaultValue={config.logRetentionDays ?? 10}
            key={config.logRetentionDays ?? 10}
            onBlur={async (e) => {
              const value = Number(e.target.value)
              if (!Number.isFinite(value)) {
                e.target.value = String(config.logRetentionDays ?? 10)
                return
              }
              const next = await window.api.settings.set({ logRetentionDays: value })
              setConfig(next)
              toast({
                title: 'Log retention updated',
                description: `Keep logs for ${next.logRetentionDays} day(s).`,
                variant: 'success'
              })
            }}
          />
          <span className="muted">days</span>
        </div>
      </section>

      <section className="card">
        <h3>Download quality</h3>
        <select
          value={config.downloadQuality}
          onChange={async (e) => {
            const next = await window.api.settings.set({ downloadQuality: e.target.value })
            setConfig(next)
            toast({
              title: 'Download quality updated',
              description:
                next.downloadQuality === 'best' ? 'Best available' : `${next.downloadQuality} kbps`,
              variant: 'success'
            })
          }}
        >
          <option value="best">Best available</option>
          <option value="128">128 kbps</option>
          <option value="192">192 kbps</option>
          <option value="256">256 kbps</option>
          <option value="320">320 kbps</option>
        </select>
      </section>
    </div>
  )
}
