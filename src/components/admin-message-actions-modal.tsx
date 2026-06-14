import { useId, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBan,
  faShieldHalved,
  faTrashCan,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useDialogFocus } from '../hooks/use-dialog-focus'
import type { AdminAction, AdminMessageActionTarget } from '../types/admin'

type AdminMessageActionsModalProps = {
  active: boolean
  onClose: () => void
  onSelectAction: (
    action: Extract<AdminAction, { kind: 'delete' | 'warn' | 'ban' }>,
  ) => void
  target: AdminMessageActionTarget | null
  visible: boolean
}

export function AdminMessageActionsModal({
  active,
  onClose,
  onSelectAction,
  target,
  visible,
}: AdminMessageActionsModalProps) {
  const titleId = useId()
  const bodyId = useId()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(active, closeButtonRef)

  if (!visible || !target) {
    return null
  }

  return (
    <div
      className="admin-overlay"
      data-active={active}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="admin-message-dialog"
        data-active={active}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="admin-message-header">
          <div className="admin-message-mark" aria-hidden="true">
            <FontAwesomeIcon icon={faShieldHalved} />
          </div>
          <div>
            <h2 id={titleId}>Message actions</h2>
            <p id={bodyId}>
              Moderate <strong>{target.nickname}</strong>
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="admin-icon-button admin-close-button"
            onClick={onClose}
            aria-label="Close message actions"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="admin-message-options">
          <button
            type="button"
            onClick={() =>
              onSelectAction({
                kind: 'delete',
                messageId: target.messageId,
              })
            }
          >
            <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
            <span>
              <strong>Delete message</strong>
              <small>Replace this message with a deletion notice</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              onSelectAction({
                kind: 'warn',
                messageId: target.messageId,
              })
            }
          >
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            <span>
              <strong>Delete and warn</strong>
              <small>Remove the message and notify the user</small>
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              onSelectAction({
                kind: 'ban',
                nickname: target.nickname,
              })
            }
          >
            <FontAwesomeIcon icon={faBan} aria-hidden="true" />
            <span>
              <strong>Ban user</strong>
              <small>Block access and redact their messages</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
