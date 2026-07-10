import { useEffect, useState } from 'react'
import { ProgressBar } from '../components/ProgressBar'
import { useToast } from '../components/Toast'
import type { PlaylistSummary, SyncProgress } from '../../../shared/types'

function normalizePlaylistId(id: string): string {
  return id.startsWith('VL') ? id.slice(2) : id
}

function samePlaylistId(a: string, b: string): boolean {
  return normalizePlaylistId(a) === normalizePlaylistId(b)
}

function syncPhaseLabel(progress: SyncProgress): string {
  if (progress.phase === 'fetching') return 'Fetching playlist...'
  if (progress.phase === 'deleting') {
    return `Removing deleted tracks (${progress.current}/${Math.max(progress.total, 1)})...`
  }
  if (progress.phase === 'downloading') {
    const track = progress.currentTrack ? ` · ${progress.currentTrack}` : ''
    return `Downloading (${progress.current}/${Math.max(progress.total, 1)})${track}`
  }
  return 'Finishing...'
}

export function PlaylistsPage(): React.JSX.Element {
  const { toast } = useToast()
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manualInput, setManualInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PlaylistSummary | null>(null)
  const [deleteFolder, setDeleteFolder] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [auth, setAuth] = useState<{ isAuthenticated: boolean } | null>(null)
  const [syncRunning, setSyncRunning] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.playlists.list()
      setPlaylists(result.playlists)
      if (result.libraryError) {
        setError(
          `Could not load library playlists (${result.libraryError}). Showing saved/manual playlists only.`
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlists')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void window.api.auth.status().then(setAuth)
    void window.api.sync.isRunning().then(setSyncRunning)
  }, [])

  useEffect(() => {
    const unsubProgress = window.api.sync.onProgress((progress) => {
      setSyncRunning(true)
      setSyncProgress(progress)
    })
    const unsubDone = window.api.sync.onDone(() => {
      setSyncRunning(false)
      setSyncProgress(null)
      void load()
    })

    return () => {
      unsubProgress()
      unsubDone()
    }
  }, [])

  const toggle = async (playlist: PlaylistSummary): Promise<void> => {
    const nextSelected = !playlist.selected
    const config = await window.api.playlists.toggle(playlist.id, nextSelected)
    setPlaylists((current) =>
      current.map((item) =>
        item.id === playlist.id
          ? { ...item, selected: config.selectedPlaylists.includes(item.id) }
          : item
      )
    )
  }

  const addManual = async (): Promise<void> => {
    if (!manualInput.trim()) return
    setAdding(true)
    setError(null)
    try {
      const added = await window.api.playlists.add(manualInput.trim())
      setManualInput('')
      setPlaylists((current) => {
        const without = current.filter((item) => item.id !== added.id)
        return [added, ...without]
      })
      toast({
        title: 'Playlist added',
        description: added.title,
        variant: 'success'
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add playlist'
      setError(message)
      toast({ title: 'Could not add playlist', description: message, variant: 'error' })
    } finally {
      setAdding(false)
    }
  }

  const syncPlaylist = async (playlist: PlaylistSummary): Promise<void> => {
    if (syncRunning) return
    setError(null)
    setSyncProgress(null)
    setSyncRunning(true)
    try {
      await window.api.playlists.sync(playlist.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sync playlist'
      setSyncRunning(false)
      setSyncProgress(null)
      if (/sync stopped/i.test(message)) {
        setError(null)
        return
      }
      if (/already running/i.test(message)) {
        setSyncRunning(true)
        setError(null)
        return
      }
      setError(message)
      toast({ title: 'Sync failed', description: message, variant: 'error' })
    } finally {
      const stillRunning = await window.api.sync.isRunning()
      setSyncRunning(stillRunning)
      if (!stillRunning) setSyncProgress(null)
    }
  }

  const openRemoveDialog = (playlist: PlaylistSummary): void => {
    setRemoveTarget(playlist)
    setDeleteFolder(false)
  }

  const closeRemoveDialog = (): void => {
    if (removing) return
    setRemoveTarget(null)
    setDeleteFolder(false)
  }

  const confirmRemove = async (): Promise<void> => {
    if (!removeTarget) return
    setRemoving(true)
    setError(null)
    try {
      const title = removeTarget.title
      await window.api.playlists.remove(removeTarget.id, deleteFolder)
      setPlaylists((current) => current.filter((item) => item.id !== removeTarget.id))
      setRemoveTarget(null)
      setDeleteFolder(false)
      toast({
        title: 'Playlist removed',
        description: deleteFolder ? `${title} and its local folder` : title,
        variant: 'success'
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove playlist'
      setError(message)
      toast({ title: 'Could not remove playlist', description: message, variant: 'error' })
    } finally {
      setRemoving(false)
    }
  }

  if (loading) return <div className="page">Loading playlists...</div>

  return (
    <div className="page">
      <div className="page-header">
        <h2>Playlists</h2>
        <button onClick={() => void load()}>Refresh</button>
      </div>

      <section className="card">
        <h3>Add playlist manually</h3>
        <p className="muted">
          If your library list is empty, paste a playlist URL or ID (for example
          {' '}
          <code>PLxxx...</code> or <code>LM</code> for Liked Music).
        </p>
        <div className="row">
          <input
            className="text-input"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="https://music.youtube.com/playlist?list=..."
          />
          <button disabled={adding || !manualInput.trim()} onClick={() => void addManual()}>
            {adding ? 'Adding...' : 'Add playlist'}
          </button>
        </div>
      </section>

      {!auth?.isAuthenticated ? (
        <div className="banner">Sign in on the Settings page before syncing.</div>
      ) : null}

      {error ? <div className="banner error">{error}</div> : null}

      {playlists.length === 0 ? (
        <div className="card muted">
          No library playlists returned. Use the form above to add a playlist by URL, or sign out and
          import cookies.txt from a browser where YouTube Music is already logged in.
        </div>
      ) : (
        <div className="playlist-grid">
          {playlists.map((playlist) => {
            const isActive =
              syncRunning &&
              syncProgress !== null &&
              samePlaylistId(syncProgress.playlistId, playlist.id)

            return (
              <div key={playlist.id} className="playlist-card">
                <label className="playlist-select">
                  <input
                    type="checkbox"
                    checked={playlist.selected}
                    disabled={syncRunning}
                    onChange={() => void toggle(playlist)}
                  />
                  <div className="playlist-info">
                    <div className="playlist-title">{playlist.title}</div>
                    <div className="muted">
                      {playlist.count} tracks
                      {playlist.lastSyncedAt
                        ? ` · last synced ${new Date(playlist.lastSyncedAt).toLocaleString()}`
                        : ''}
                    </div>
                    {isActive && syncProgress ? (
                      <div className="playlist-sync-progress">
                        <ProgressBar
                          value={syncProgress.current}
                          max={Math.max(syncProgress.total, 1)}
                          label={syncPhaseLabel(syncProgress)}
                        />
                      </div>
                    ) : null}
                  </div>
                </label>
                <div className="playlist-actions">
                  <button
                    type="button"
                    disabled={
                      !auth?.isAuthenticated || syncRunning || !playlist.selected
                    }
                    onClick={() => void syncPlaylist(playlist)}
                  >
                    {isActive ? 'Syncing...' : 'Sync'}
                  </button>
                  <button
                    type="button"
                    className="button-danger"
                    disabled={syncRunning}
                    onClick={() => openRemoveDialog(playlist)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {removeTarget ? (
        <div className="modal-overlay" onClick={closeRemoveDialog}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Remove playlist?</h3>
            <p>
              Remove <strong>{removeTarget.title}</strong> from YTM-Synk? This will stop syncing it.
            </p>
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={deleteFolder}
                onChange={(event) => setDeleteFolder(event.target.checked)}
              />
              Also delete the local folder from disk
            </label>
            <div className="modal-actions">
              <button type="button" disabled={removing} onClick={closeRemoveDialog}>
                Cancel
              </button>
              <button
                type="button"
                className="button-danger"
                disabled={removing}
                onClick={() => void confirmRemove()}
              >
                {removing ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
