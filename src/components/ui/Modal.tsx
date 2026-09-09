import { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  width?: number
  scrollable?: boolean
  children: ReactNode
  footer: ReactNode
}

export default function Modal({
  open, onClose, title, subtitle,
  width = 480, scrollable = false,
  children, footer,
}: ModalProps) {
  if (!open) return null
  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        style={{ width, ...(scrollable ? { maxHeight: '85vh', overflowY: 'auto' } : {}) }}
      >
        <div
          className="modal-head"
          style={scrollable ? { position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 } : undefined}
        >
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="panel-close-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        <div
          className="modal-footer"
          style={scrollable ? { position: 'sticky', bottom: 0, background: 'var(--surface)' } : undefined}
        >
          {footer}
        </div>
      </div>
    </div>
  )
}
