import { useEffect, useMemo, useState } from 'react'
import { LogViewer, ProgressBar } from '../components/ProgressBar'
import { useToast } from '../components/Toast'
import type { SyncLogEntry, SyncProgress, SyncSummary } from '../../../shared/types'

interface LogItem {
  id: string
  text: string
  level: string
}

function isSyncStoppedMessage(message: string): boolean {
  return /sync stopped/i.test(message)
}

function isAlreadyRunningMessage(message: string): boolean {
  return /already running/i.test(message)
}

export function SyncPage(): React.JSX.Element {
  const { toast } = useToast()
  const [auth, setAuth] = useState<{ isAuthenticated: boolean } | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [summary, setSummary] = useState<SyncSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.auth.status().then(setAuth)
    void window.api.sync.isRunning().then(setRunning)
  }, [])

  useEffect(() => {
    const unsubProgress = window.api.sync.onProgress((entry: SyncProgress) => {
      setRunning(true)
      setProgress(entry)
    })
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
      setSummary(result.stopped ? null : result)
      setRunning(false)
      setStopping(false)
      if (result.stopped) {
        setError(null)
        toast({
          title: 'Sync stopped',
          description: 'Synchronization was cancelled.',
          variant: 'info'
        })
      }
    })

    return () => {
      unsubProgress()
      unsubLog()
      unsubDone()
    }
  }, [toast])

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

  const overallProgress = useMemo(() => {
    if (!progress || progress.playlistTotal <= 1) return null
    const completed = Math.max(0, progress.playlistIndex - 1)
    const trackFraction =
      progress.phase === 'done'
        ? 1
        : progress.total > 0
          ? Math.min(1, Math.max(0, progress.current / progress.total))
          : 0
    return {
      label: `Playlist ${progress.playlistIndex} of ${progress.playlistTotal}`,
      value: completed + trackFraction,
      max: progress.playlistTotal
    }
  }, [progress])

  const runSync = async (): Promise<void> => {
    if (running) return
    setRunning(true)
    setStopping(false)
    setError(null)
    setSummary(null)
    setLogs([])
    setProgress(null)
    try {
      const result = await window.api.sync.run()
      setSummary(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      if (isAlreadyRunningMessage(message)) {
        setRunning(true)
        setError(null)
        return
      }
      if (isSyncStoppedMessage(message)) {
        setError(null)
        return
      }
      setError(message)
      toast({ title: 'Sync failed', description: message, variant: 'error' })
    } finally {
      const stillRunning = await window.api.sync.isRunning()
      setRunning(stillRunning)
      if (!stillRunning) setStopping(false)
    }
  }

  const stopSync = async (): Promise<void> => {
    if (!running || stopping) return
    setStopping(true)
    try {
      await window.api.sync.stop()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop sync'
      setStopping(false)
      toast({ title: 'Could not stop sync', description: message, variant: 'error' })
    }
  }

  return (
    <div className="page page-sync">
      <div className="page-header">
        <h2>Sync</h2>
        {running ? (
          <button className="button-danger" disabled={stopping} onClick={() => void stopSync()}>
            {stopping ? 'Stopping...' : 'Stop'}
          </button>
        ) : (
          <button disabled={!auth?.isAuthenticated} onClick={() => void runSync()}>
            Sync now
          </button>
        )}
      </div>

      {!auth?.isAuthenticated ? (
        <div className="banner">Sign in on the Settings page before syncing.</div>
      ) : null}

      {error ? <div className="banner error">{error}</div> : null}

      {progress ? (
        <section className="card">
          {overallProgress ? (
            <ProgressBar
              value={overallProgress.value}
              max={overallProgress.max}
              label={overallProgress.label}
            />
          ) : null}
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
