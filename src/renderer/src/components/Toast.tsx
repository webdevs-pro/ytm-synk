import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
  action?: ToastAction
}

interface ToastItem extends Required<Pick<ToastInput, 'title' | 'variant' | 'duration'>> {
  id: string
  description?: string
  action?: ToastAction
}

interface ToastContextValue {
  toast: (input: ToastInput) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DEFAULT_DURATION = 4500

let toastId = 0

function nextId(): string {
  toastId += 1
  return `toast-${toastId}`
}

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (input: ToastInput): string => {
      const id = nextId()
      const duration = input.duration ?? DEFAULT_DURATION
      const item: ToastItem = {
        id,
        title: input.title,
        description: input.description,
        variant: input.variant ?? 'info',
        duration,
        action: input.action
      }

      setToasts((current) => [...current, item].slice(-4))

      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration)
        timers.current.set(id, timer)
      }

      return id
    },
    [dismiss]
  )

  useEffect(() => {
    const activeTimers = timers.current
    return () => {
      for (const timer of activeTimers.values()) clearTimeout(timer)
      activeTimers.clear()
    }
  }, [])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.variant}`} role="status">
            <div className="toast-body">
              <div className="toast-title">{item.title}</div>
              {item.description ? <div className="toast-description">{item.description}</div> : null}
            </div>
            <div className="toast-actions">
              {item.action ? (
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => {
                    item.action?.onClick()
                    dismiss(item.id)
                  }}
                >
                  {item.action.label}
                </button>
              ) : null}
              <button
                type="button"
                className="toast-dismiss"
                aria-label="Dismiss"
                onClick={() => dismiss(item.id)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
