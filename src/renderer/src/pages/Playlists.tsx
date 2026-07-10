import { useEffect, useState } from 'react'
import type { PlaylistSummary } from '../../../shared/types'

export function PlaylistsPage(): React.JSX.Element {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [manualInput, setManualInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PlaylistSummary | null>(null)
  const [deleteFolder, setDeleteFolder] = useState(false)
  const [removing, setRemoving] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const items = await window.api.playlists.list()
      setPlaylists(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playlists')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add playlist')
    } finally {
      setAdding(false)
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
      await window.api.playlists.remove(removeTarget.id, deleteFolder)
      setPlaylists((current) => current.filter((item) => item.id !== removeTarget.id))
      setRemoveTarget(null)
      setDeleteFolder(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove playlist')
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

      {error ? <div className="banner error">{error}</div> : null}

      {playlists.length === 0 ? (
        <div className="card muted">
          No library playlists returned. Use the form above to add a playlist by URL, or sign out and
          import cookies.txt from a browser where YouTube Music is already logged in.
        </div>
      ) : (
        <div className="playlist-grid">
          {playlists.map((playlist) => (
            <div key={playlist.id} className="playlist-card">
              <label className="playlist-select">
                <input
                  type="checkbox"
                  checked={playlist.selected}
                  onChange={() => void toggle(playlist)}
                />
                <div>
                  <div className="playlist-title">{playlist.title}</div>
                  <div className="muted">
                    {playlist.count} tracks
                    {playlist.lastSyncedAt
                      ? ` · last synced ${new Date(playlist.lastSyncedAt).toLocaleString()}`
                      : ''}
                  </div>
                </div>
              </label>
              <button
                type="button"
                className="button-danger"
                onClick={() => openRemoveDialog(playlist)}
              >
                Remove
              </button>
            </div>
          ))}
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
