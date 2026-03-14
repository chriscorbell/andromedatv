type ChatMessageListEntry = {
  id: number
  nickname: string
  body: string
  is_admin?: boolean
}

type ChatMessageListProps = {
  loading: boolean
  messages: ChatMessageListEntry[]
  onAdminAction?: (messageId: number, nickname: string) => void
}

function getNicknameClass(entry: ChatMessageListEntry) {
  if (entry.nickname === 'system') {
    return 'text-[#f7768e]'
  }

  if (entry.is_admin) {
    return 'text-[#73daca]'
  }

  return 'text-zinc-100'
}

export function ChatMessageList({
  loading,
  messages,
  onAdminAction,
}: ChatMessageListProps) {
  return (
    <ul className="divide-y divide-zinc-800">
      {messages.length === 0 && !loading && (
        <li className="px-4 py-6 text-zinc-500">
          No messages yet.
        </li>
      )}
      {messages.map((entry) => (
        <li
          key={`${entry.id}`}
          className="px-4 py-2 text-zinc-400 animate-[fadeIn_220ms_ease-out] motion-reduce:animate-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className={getNicknameClass(entry)}>
                {entry.nickname}
              </span>{' '}
              {entry.body === 'message deleted' ? (
                <span className="italic break-words whitespace-pre-wrap text-zinc-500">message deleted</span>
              ) : entry.nickname === 'system' ? (
                <span className="italic break-words whitespace-pre-wrap text-zinc-500">{entry.body}</span>
              ) : (
                <span className="break-words whitespace-pre-wrap">{entry.body}</span>
              )}
            </div>
            {onAdminAction && (
              <button
                type="button"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-zinc-500 transition hover:text-zinc-200 cursor-pointer"
                aria-label="Message admin actions"
                onClick={() => onAdminAction(entry.id, entry.nickname)}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="5" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="12" cy="19" r="1.8" />
                </svg>
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
