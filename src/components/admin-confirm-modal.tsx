import { useId, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRotateLeft,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { useDialogFocus } from '../hooks/use-dialog-focus'

type AdminConfirmModalProps = {
  active: boolean
  body: string
  onCancel: () => void
  onConfirm: () => void
  title: string
  tone?: 'accent' | 'danger'
  visible: boolean
}

export function AdminConfirmModal({
  active,
  body,
  onCancel,
  onConfirm,
  title,
  tone = 'danger',
  visible,
}: AdminConfirmModalProps) {
  const titleId = useId()
  const bodyId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(active, cancelButtonRef)

  if (!visible) {
    return null
  }

  return (
    <div
      className="admin-overlay"
      data-active={active}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        tabIndex={-1}
        className="admin-confirm-dialog"
        data-active={active}
        data-tone={tone}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-confirm-icon" aria-hidden="true">
          <FontAwesomeIcon
            icon={
              tone === 'accent' ? faArrowRotateLeft : faTriangleExclamation
            }
          />
        </div>
        <div className="admin-confirm-copy">
          <span>Confirm action</span>
          <h2 id={titleId}>{title}</h2>
          {body && <p id={bodyId}>{body}</p>}
        </div>
        <div className="admin-confirm-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="admin-confirm-cancel"
            onClick={onCancel}
          >
            cancel
          </button>
          <button
            type="button"
            className="admin-confirm-submit"
            onClick={onConfirm}
          >
            confirm
          </button>
        </div>
      </div>
    </div>
  )
}
