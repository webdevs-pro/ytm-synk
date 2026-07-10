import { useEffect, useState } from 'react'

export function ProgressBar({
  value,
  max = 100,
  label
}: {
  value: number
  max?: number
  label?: string
}): React.JSX.Element {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="progress-block">
      {label ? <div className="progress-label">{label}</div> : null}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-percent">{percent}%</div>
    </div>
  )
}

export function LogViewer({ entries }: { entries: Array<{ id: string; text: string; level: string }> }): React.JSX.Element {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (container) container.scrollTop = container.scrollHeight
  }, [entries, container])

  return (
    <div className="log-viewer" ref={setContainer}>
      {entries.length === 0 ? <div className="muted">No log entries yet.</div> : null}
      {entries.map((entry) => (
        <div key={entry.id} className={`log-line log-${entry.level}`}>
          {entry.text}
        </div>
      ))}
    </div>
  )
}
