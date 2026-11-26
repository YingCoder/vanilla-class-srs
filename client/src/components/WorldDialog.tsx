import { useEffect, useRef, type ReactNode } from 'react'

export default function WorldDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close() }
  }, [])
  return <dialog ref={ref} className="world-dialog camp-modal-card" aria-label={title} onCancel={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="world-dialog-content">
      <div className="world-intro-heading"><h2>{title}</h2><button type="button" className="candy-pill" onClick={onClose} autoFocus>关闭</button></div>
      {children}
    </div>
  </dialog>
}
