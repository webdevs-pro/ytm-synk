import { useEffect, useMemo, useState } from 'react'
import { LogViewer, ProgressBar } from '../components/ProgressBar'
import type { SyncLogEntry, SyncProgress, SyncSummary } from '../../../shared/types'

interface LogItem {
  id: string
  text: string
  level: string
}

export function SyncPage(): React.JSX.Element {
  const [auth, setAuth] = useState<{ isAuthenticated: boolean } | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [summary, setSummary] = useState<SyncSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.auth.status().then(setAuth)
  }, [])

  useEffect(() => {
    const unsubProgress = window.api.sync.onProgress((entry: SyncProgress) => setProgress(entry))
    const unsubLog = window.api.sync.onLog((entry: SyncLogEntry) => {
      setLogs((current) => [
        ...current,
        {
          id: `${entry.timestamp}-${current.length}`,
          text: `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.message}`,
          level: entry.level
        }
      ])
    })
    const unsubDone = window.api.sync.onDone((result: SyncSummary) => {
      setSummary(result)
      setRunning(false)
    })

    return () => {
      unsubProgress()
      unsubLog()
      unsubDone()
    }
  }, [])

  const progressLabel = useMemo(() => {
    if (!progress) return undefined
    const phaseLabel =
      progress.phase === 'fetching'
        ? 'Fetching playlist'
        : progress.phase === 'deleting'
          ? 'Removing deleted tracks'
          : progress.phase === 'downloading'
            ? 'Downloading tracks'
            : 'Finished'
    const track = progress.currentTrack ? ` · ${progress.currentTrack}` : ''
    return `${progress.playlistName}: ${phaseLabel}${track}`
  }, [progress])

  const runSync = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    setSummary(null)
    setLogs([])
    setProgress(null)
    try {
      const result = await window.api.sync.run()
      setSummary(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="page page-sync">
      <div className="page-header">
        <h2>Sync</h2>
        <button disabled={running || !auth?.isAuthenticated} onClick={() => void runSync()}>
          {running ? 'Syncing...' : 'Sync now'}
        </button>
      </div>

      {!auth?.isAuthenticated ? (
        <div className="banner">Sign in on the Settings page before syncing.</div>
      ) : null}

      {error ? <div className="banner error">{error}</div> : null}

      {progress ? (
        <section className="card">
          <ProgressBar
            value={progress.current}
            max={Math.max(progress.total, 1)}
            label={progressLabel}
          />
        </section>
      ) : null}

      {summary ? (
        <section className="card summary">
          <strong>Sync complete.</strong> Downloaded {summary.downloaded}, deleted {summary.deleted},
          skipped {summary.skipped}, errors {summary.errors} across {summary.playlists} playlists.
        </section>
      ) : null}

      <section className="card card-fill">
        <h3>Activity log</h3>
        <LogViewer entries={logs} />
      </section>
    </div>
  )
}
