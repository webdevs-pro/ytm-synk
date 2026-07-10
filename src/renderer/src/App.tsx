import { useEffect, useRef, useState } from 'react'
import { ToastProvider, useToast } from './components/Toast'
import { PlaylistsPage } from './pages/Playlists'
import { SettingsPage } from './pages/Settings'
import { SyncPage } from './pages/Sync'
import type { AppUpdateState, AppUpdateStatus, SyncSummary } from '../../shared/types'

type Tab = 'playlists' | 'sync' | 'settings'

function formatSyncSummary(summary: SyncSummary): string {
  return `Downloaded ${summary.downloaded}, deleted ${summary.deleted}, skipped ${summary.skipped}, errors ${summary.errors}`
}

function AppToasts(): null {
  const { toast } = useToast()
  const lastUpdateState = useRef<AppUpdateState | null>(null)

  useEffect(() => {
    const unsubDone = window.api.sync.onDone((summary: SyncSummary) => {
      // Hard failures also emit SYNC_DONE then throw; pages toast the real error message.
      const hardFailure =
        summary.playlists === 0 &&
        summary.downloaded === 0 &&
        summary.deleted === 0 &&
        summary.skipped === 0 &&
        summary.errors > 0
      if (hardFailure) return

      const hasErrors = summary.errors > 0
      toast({
        title: hasErrors ? 'Sync finished with errors' : 'Sync complete',
        description: formatSyncSummary(summary),
        variant: hasErrors ? 'warning' : 'success'
      })
    })

    const unsubUpdate = window.api.updater.onStatus((status: AppUpdateStatus) => {
      if (status.state === lastUpdateState.current) return
      lastUpdateState.current = status.state

      if (status.state === 'available') {
        toast({
          title: 'Update available',
          description: `Version ${status.availableVersion} is ready to download.`,
          variant: 'info',
          duration: 0,
          action: {
            label: 'Download',
            onClick: () => {
              void window.api.updater.download()
            }
          }
        })
        return
      }

      if (status.state === 'downloading') {
        toast({
          title: 'Downloading update',
          description: `Version ${status.availableVersion || ''}…`,
          variant: 'info'
        })
        return
      }

      if (status.state === 'downloaded') {
        toast({
          title: 'Update ready',
          description: `Version ${status.availableVersion} is ready to install.`,
          variant: 'success',
          duration: 0,
          action: {
            label: 'Restart',
            onClick: () => {
              void window.api.updater.install()
            }
          }
        })
        return
      }

      if (status.state === 'error') {
        toast({
          title: 'Update failed',
          description: status.message || 'Could not check for updates.',
          variant: 'error',
          duration: status.availableVersion ? 0 : undefined,
          action: status.availableVersion
            ? {
                label: 'Retry download',
                onClick: () => {
                  void window.api.updater.download()
                }
              }
            : undefined
        })
      }
    })

    return () => {
      unsubDone()
      unsubUpdate()
    }
  }, [toast])

  return null
}

function AppShell(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('playlists')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>YTM-Synk</h1>
          <p className="muted">Mirror YouTube Music playlists to local MP3 folders</p>
        </div>
        <nav className="tabs">
          <button className={tab === 'playlists' ? 'active' : ''} onClick={() => setTab('playlists')}>
            Playlists
          </button>
          <button className={tab === 'sync' ? 'active' : ''} onClick={() => setTab('sync')}>
            Sync
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            Settings
          </button>
        </nav>
      </header>

      <main className="app-main">
        <div className={tab === 'playlists' ? 'tab-panel' : 'tab-panel hidden'}>
          <PlaylistsPage />
        </div>
        <div className={tab === 'sync' ? 'tab-panel' : 'tab-panel hidden'}>
          <SyncPage />
        </div>
        <div className={tab === 'settings' ? 'tab-panel' : 'tab-panel hidden'}>
          <SettingsPage />
        </div>
      </main>
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AppToasts />
      <AppShell />
    </ToastProvider>
  )
}

export default App
