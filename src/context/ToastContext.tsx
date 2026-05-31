import { createContext, useContext, useState, ReactNode, useCallback } from 'react'

interface ToastCtx {
  showToast: (msg: string) => void
}

const ToastContext = createContext<ToastCtx>({ showToast: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('')

  const showToast = useCallback((text: string) => {
    setMsg(text)
    setTimeout(() => setMsg(''), 2800)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {msg && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--text)', color: '#fff', padding: '10px 20px',
          borderRadius: 'var(--radius-lg)', fontSize: 13, fontWeight: 500,
          zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)', whiteSpace: 'nowrap',
        }}>
          <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 15 }} /> {msg}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
