import { useId, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRotateLeft,
  faBan,
  faMagnifyingGlass,
  faShieldHalved,
  faTrashCan,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useDialogFocus } from '../hooks/use-dialog-focus'
import type {
  AdminAction,
  AdminMenuView,
  AdminUserLists,
  AdminUserLoading,
} from '../types/admin'

type AdminMenuModalProps = {
  active: boolean
  onClose: () => void
  onOpenClearChatConfirm: () => void
  onOpenUserView: (view: AdminMenuView) => void
  onSearchChange: (value: string) => void
  onUserAction: (action: AdminAction) => void
  search: string
  userLists: AdminUserLists
  userLoading: AdminUserLoading
  view: AdminMenuView
  viewAnimating: boolean
  visible: boolean
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const getJoinedLabel = (createdAt: string) => {
  const date = new Date(createdAt)

  if (Number.isNaN(date.getTime())) {
    return 'Join date unavailable'
  }

  return `Joined ${dateFormatter.format(date)}`
}

export function AdminMenuModal({
  active,
  onClose,
  onOpenClearChatConfirm,
  onOpenUserView,
  onSearchChange,
  onUserAction,
  search,
  userLists,
  userLoading,
  view,
  viewAnimating,
  visible,
}: AdminMenuModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const tabListId = useId()
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useDialogFocus<HTMLDivElement>(active, searchInputRef)

  if (!visible) {
    return null
  }

  const users = userLists[view]
  const normalizedSearch = search.trim().toLowerCase()
  const filteredUsers = users.filter((user) =>
    user.nickname.toLowerCase().includes(normalizedSearch),
  )
  const activeTabId = `${tabListId}-${view}`
  const panelId = `${tabListId}-panel`

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
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="admin-dialog"
        data-active={active}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="admin-header">
          <div className="admin-heading-mark" aria-hidden="true">
            <FontAwesomeIcon icon={faShieldHalved} />
          </div>
          <div className="admin-heading-copy">
            <h2 id={titleId}>Admin</h2>
            <p id={descriptionId}>Moderation tools</p>
          </div>
          <button
            type="button"
            className="admin-icon-button admin-close-button"
            onClick={onClose}
            aria-label="Close admin controls"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="admin-content">
          <div
            className="admin-tabs"
            role="tablist"
            aria-label="User status"
          >
            {(['active', 'banned'] as const).map((tab) => (
              <button
                key={tab}
                id={`${tabListId}-${tab}`}
                type="button"
                role="tab"
                aria-controls={panelId}
                aria-selected={view === tab}
                className="admin-tab"
                data-selected={view === tab}
                onClick={() => onOpenUserView(tab)}
              >
                <span>{tab === 'active' ? 'Active' : 'Banned'}</span>
                <span className="admin-tab-count">
                  {userLoading[tab] && userLists[tab].length === 0
                    ? '...'
                    : userLists[tab].length}
                </span>
              </button>
            ))}
          </div>

          <label className="admin-search" htmlFor="admin-user-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
            <span className="sr-only">Search {view} users</span>
            <input
              id="admin-user-search"
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={`Search ${view} users`}
              autoComplete="off"
            />
          </label>

          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={activeTabId}
            aria-busy={userLoading[view]}
            className="admin-user-list scrollbar-minimal"
            data-transitioning={viewAnimating}
          >
            {userLoading[view] ? (
              <div className="admin-loading" aria-label="Loading users">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="admin-user-skeleton">
                    <span />
                    <span />
                  </div>
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="admin-empty-state">
                <FontAwesomeIcon icon={faShieldHalved} aria-hidden="true" />
                <strong>
                  {search ? 'No matching users' : `No ${view} users`}
                </strong>
                <span>
                  {search
                    ? 'Try a different nickname.'
                    : view === 'active'
                      ? 'New accounts will appear here.'
                      : 'Banned accounts will appear here.'}
                </span>
              </div>
            ) : (
              <ul className="admin-users">
                {filteredUsers.map((user) => (
                  <li key={user.nickname} className="admin-user-row">
                    <span className="admin-user-copy">
                      <strong>{user.nickname}</strong>
                      <span>{getJoinedLabel(user.created_at)}</span>
                    </span>
                    <span className="admin-user-actions">
                      {view === 'active' ? (
                        <button
                          type="button"
                          className="admin-action-button"
                          onClick={() =>
                            onUserAction({
                              kind: 'ban',
                              nickname: user.nickname,
                            })
                          }
                          aria-label={`Ban ${user.nickname}`}
                        >
                          <FontAwesomeIcon icon={faBan} aria-hidden="true" />
                          <span>Ban</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-action-button admin-action-button-positive"
                          onClick={() =>
                            onUserAction({
                              kind: 'unban',
                              nickname: user.nickname,
                            })
                          }
                          aria-label={`Unban ${user.nickname}`}
                        >
                          <FontAwesomeIcon
                            icon={faArrowRotateLeft}
                            aria-hidden="true"
                          />
                          <span>Unban</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-delete-button"
                        onClick={() =>
                          onUserAction({
                            kind: 'delete-user',
                            nickname: user.nickname,
                          })
                        }
                        aria-label={`Delete ${user.nickname}`}
                      >
                        <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="admin-danger-zone">
            <div className="admin-danger-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faTriangleExclamation} />
            </div>
            <div className="admin-danger-copy">
              <strong>Clear chat history</strong>
              <span>Removes all messages and system logs</span>
            </div>
            <button
              type="button"
              className="admin-clear-button"
              onClick={onOpenClearChatConfirm}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
