import { useState } from 'react'
import { PlaylistsPage } from './pages/Playlists'
import { SettingsPage } from './pages/Settings'
import { SyncPage } from './pages/Sync'

type Tab = 'playlists' | 'sync' | 'settings'

function App(): React.JSX.Element {
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
        {tab === 'playlists' ? <PlaylistsPage /> : null}
        {tab === 'sync' ? <SyncPage /> : null}
        {tab === 'settings' ? <SettingsPage /> : null}
      </main>
    </div>
  )
}

export default App
