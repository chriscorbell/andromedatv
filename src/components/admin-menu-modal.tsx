import type { AdminAction, AdminMenuView, AdminUser } from '../types/admin'

type AdminMenuModalProps = {
  active: boolean
  onBack: () => void
  onClose: () => void
  onOpenClearChatConfirm: () => void
  onOpenUserView: (view: 'active' | 'banned') => void
  onSearchChange: (value: string) => void
  onUserAction: (action: AdminAction) => void
  search: string
  userList: AdminUser[]
  userLoading: boolean
  view: AdminMenuView
  viewAnimating: boolean
  visible: boolean
}

export function AdminMenuModal({
  active,
  onBack,
  onClose,
  onOpenClearChatConfirm,
  onOpenUserView,
  onSearchChange,
  onUserAction,
  search,
  userList,
  userLoading,
  view,
  viewAnimating,
  visible,
}: AdminMenuModalProps) {
  if (!visible) {
    return null
  }

  const searchLower = search.toLowerCase()
  const filteredUsers = userList.filter((user) =>
    user.nickname.toLowerCase().includes(searchLower),
  )

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 transition-opacity duration-200 ${active ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md border border-zinc-800 bg-[#050505] text-zinc-200 shadow-xl transition duration-200 ${active ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`transition-opacity duration-120 ${viewAnimating ? 'opacity-0' : 'opacity-100'}`}>
          {view === 'main' && (
            <div className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="ui-header font-extrabold">admin</div>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center text-zinc-500 transition hover:text-zinc-200 cursor-pointer"
                  onClick={onClose}
                  aria-label="Close admin menu"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12" />
                    <path d="M18 6l-12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  className="w-full border border-zinc-800 px-3 py-2 text-left text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100 cursor-pointer"
                  onClick={onOpenClearChatConfirm}
                >
                  wipe chat
                </button>
                <button
                  type="button"
                  className="w-full border border-zinc-800 px-3 py-2 text-left text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100 cursor-pointer"
                  onClick={() => onOpenUserView('active')}
                >
                  active users
                </button>
                <button
                  type="button"
                  className="w-full border border-zinc-800 px-3 py-2 text-left text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100 cursor-pointer"
                  onClick={() => onOpenUserView('banned')}
                >
                  banned users
                </button>
              </div>
            </div>
          )}

          {(view === 'active' || view === 'banned') && (
            <div className="flex flex-col">
              <div className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4">
                <button
                  type="button"
                  className="text-zinc-500 transition hover:text-zinc-200 cursor-pointer"
                  onClick={onBack}
                  aria-label="Back"
                >
                  ←
                </button>
                <div className="ui-header font-extrabold">
                  {view === 'active' ? 'active users' : 'banned users'}
                </div>
                <button
                  type="button"
                  className="ml-auto inline-flex h-6 w-6 items-center justify-center text-zinc-500 transition hover:text-zinc-200 cursor-pointer"
                  onClick={onClose}
                  aria-label="Close admin menu"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12" />
                    <path d="M18 6l-12 12" />
                  </svg>
                </button>
              </div>
              <div className="px-6 pt-4">
                <input
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="search users"
                  className="h-9 w-full border border-zinc-700 bg-black/40 px-3 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
                  autoFocus
                />
              </div>
              <div className="scrollbar-minimal max-h-64 min-h-[120px] overflow-y-auto px-6 py-3">
                {userLoading ? (
                  <div className="py-4 text-zinc-500">loading...</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="py-4 text-zinc-500">
                    {search ? 'no matching users' : 'no users'}
                  </div>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {filteredUsers.map((user) => (
                      <li
                        key={user.nickname}
                        className="flex items-center justify-between gap-3 border-b border-zinc-800/50 py-2 last:border-0 animate-[fadeIn_120ms_ease-out] motion-reduce:animate-none"
                      >
                        <span className="truncate text-zinc-200">
                          {user.nickname}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {view === 'active' ? (
                            <>
                              <button
                                type="button"
                                className="text-zinc-500 transition hover:text-[#f7768e] cursor-pointer"
                                onClick={() =>
                                  onUserAction({
                                    kind: 'ban',
                                    nickname: user.nickname,
                                  })
                                }
                              >
                                ban
                              </button>
                              <button
                                type="button"
                                className="text-zinc-500 transition hover:text-[#f7768e] cursor-pointer"
                                onClick={() =>
                                  onUserAction({
                                    kind: 'delete-user',
                                    nickname: user.nickname,
                                  })
                                }
                              >
                                delete
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="text-zinc-500 transition hover:text-[#73daca] cursor-pointer"
                                onClick={() =>
                                  onUserAction({
                                    kind: 'unban',
                                    nickname: user.nickname,
                                  })
                                }
                              >
                                unban
                              </button>
                              <button
                                type="button"
                                className="text-zinc-500 transition hover:text-[#f7768e] cursor-pointer"
                                onClick={() =>
                                  onUserAction({
                                    kind: 'delete-user',
                                    nickname: user.nickname,
                                  })
                                }
                              >
                                delete
                              </button>
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
