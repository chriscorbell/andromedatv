import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEllipsisVertical, faShield } from '@fortawesome/free-solid-svg-icons'

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

// Palette sampled from the design mockup — warm to cool, one assigned per user.
const NICKNAME_COLORS = [
  '#fb923c', // orange
  '#f59e0b', // amber
  '#facc15', // yellow
  '#4ade80', // green
  '#a3e635', // lime
  '#2dd4bf', // teal
  '#22d3ee', // cyan
  '#818cf8', // indigo
  '#c084fc', // purple
  '#f472b6', // pink
  '#fb7185', // rose
]

const ADMIN_NICKNAME_COLOR = '#38bdf8' // bright sky — reserved for admins

function hashNickname(nickname: string) {
  let hash = 0
  for (let index = 0; index < nickname.length; index += 1) {
    hash = (hash * 31 + nickname.charCodeAt(index)) >>> 0
  }
  return hash
}

function getNicknameColor(entry: ChatMessageListEntry) {
  if (entry.nickname === 'system') {
    return undefined
  }

  if (entry.is_admin) {
    return ADMIN_NICKNAME_COLOR
  }

  return NICKNAME_COLORS[hashNickname(entry.nickname) % NICKNAME_COLORS.length]
}

export function ChatMessageList({
  loading,
  messages,
  onAdminAction,
}: ChatMessageListProps) {
  return (
    <ul className="divide-y divide-zinc-800 border-b border-zinc-800">
      {messages.length === 0 && !loading && (
        <li className="px-4 py-6 text-zinc-500">
          No messages yet.
        </li>
      )}
      {messages.map((entry) => (
        <li
          key={`${entry.id}`}
          className="px-4 py-2 text-zinc-300 animate-[fadeIn_220ms_ease-out] motion-reduce:animate-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {(() => {
                const nicknameColor = getNicknameColor(entry)
                return (
                  <span
                    className={nicknameColor ? 'font-semibold' : 'text-zinc-500'}
                    style={nicknameColor ? { color: nicknameColor } : undefined}
                  >
                    {entry.is_admin && (
                      <FontAwesomeIcon
                        icon={faShield}
                        className="mr-1 text-[14px]"
                        title="Admin"
                      />
                    )}
                    {entry.nickname}
                  </span>
                )
              })()}{' '}
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
                <FontAwesomeIcon icon={faEllipsisVertical} className="text-[16px]" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
