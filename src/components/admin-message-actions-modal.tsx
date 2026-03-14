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
  if (!visible || !target) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 transition-opacity duration-200 ${active ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-sm border border-zinc-800 bg-[#050505] p-6 text-zinc-200 shadow-xl transition duration-200 ${active ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="ui-header font-extrabold">message actions</div>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center text-zinc-500 transition hover:text-zinc-200 cursor-pointer"
            onClick={onClose}
            aria-label="Close message actions"
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
        <p className="mt-3 text-zinc-500">
          choose an action for{' '}
          <span className="text-zinc-300">{target.nickname}</span>
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="w-full border border-zinc-800 px-3 py-2 text-left text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100 cursor-pointer"
            onClick={() =>
              onSelectAction({
                kind: 'delete',
                messageId: target.messageId,
              })
            }
          >
            delete
          </button>
          <button
            type="button"
            className="w-full border border-zinc-800 px-3 py-2 text-left text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100 cursor-pointer"
            onClick={() =>
              onSelectAction({
                kind: 'warn',
                messageId: target.messageId,
              })
            }
          >
            delete and warn
          </button>
          <button
            type="button"
            className="w-full border border-zinc-800 px-3 py-2 text-left text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-100 cursor-pointer"
            onClick={() =>
              onSelectAction({
                kind: 'ban',
                nickname: target.nickname,
              })
            }
          >
            ban
          </button>
        </div>
      </div>
    </div>
  )
}
