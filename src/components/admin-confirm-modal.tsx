type AdminConfirmModalProps = {
  active: boolean
  body: string
  onCancel: () => void
  onConfirm: () => void
  title: string
  visible: boolean
}

export function AdminConfirmModal({
  active,
  body,
  onCancel,
  onConfirm,
  title,
  visible,
}: AdminConfirmModalProps) {
  if (!visible) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 transition-opacity duration-200 ${active ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={onCancel}
    >
      <div
        className={`w-full max-w-md border border-zinc-800 bg-[#050505] p-6 text-zinc-200 shadow-xl transition duration-200 ${active ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ui-header font-extrabold">confirm</div>
        <p className="mt-3 text-zinc-400">{title}</p>
        {body && (
          <p className="mt-2 text-zinc-500">{body}</p>
        )}
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            className="text-zinc-400 transition hover:text-zinc-100 cursor-pointer"
            onClick={onCancel}
          >
            cancel
          </button>
          <button
            type="button"
            className="border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-100 transition hover:border-zinc-500 cursor-pointer"
            onClick={onConfirm}
          >
            confirm
          </button>
        </div>
      </div>
    </div>
  )
}
