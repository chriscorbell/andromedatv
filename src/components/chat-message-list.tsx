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

// One color assigned per user. Green is fine, but the mint/teal/cyan around the
// admin accent (var(--color-accent), #1fd6a6, hue ~164°) is omitted: the greens
// here are clearly yellow-leaning grass/lime tones (hue ~142° and below, with far
// less cyan) so no regular user reads as close to an admin — see
// ADMIN_NICKNAME_COLOR below.
const NICKNAME_COLORS = [
  '#fb923c', // orange
  '#f59e0b', // amber
  '#facc15', // yellow
  '#a3e635', // lime
  '#4ade80', // green
  '#38bdf8', // sky
  '#818cf8', // indigo
  '#c084fc', // purple
  '#f472b6', // pink
  '#fb7185', // rose
]

// Admins use the UI accent color so their name and shield read as one mark.
const ADMIN_NICKNAME_COLOR = 'var(--color-accent)'

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
    <ul className="flex flex-col gap-2.5 px-5 pt-2 pb-3.5">
      {messages.length === 0 && !loading && (
        <li className="py-4 text-18 text-[var(--color-faint)]">
          No messages yet.
        </li>
      )}
      {messages.map((entry) => (
        <li
          key={`${entry.id}`}
          className="group flex items-start gap-2 animate-[fadeIn_220ms_ease-out] motion-reduce:animate-none"
        >
          <div className="min-w-0 flex-1 text-18 leading-[1.4] [overflow-wrap:anywhere]">
            {(() => {
              const nicknameColor = getNicknameColor(entry)
              return (
                <span
                  className={
                    nicknameColor ? 'font-bold' : 'text-[var(--color-faint)]'
                  }
                  style={nicknameColor ? { color: nicknameColor } : undefined}
                >
                  {entry.is_admin && (
                    <FontAwesomeIcon
                      icon={faShield}
                      className="mr-1.5 text-13 text-[var(--color-accent)]"
                      title="Admin"
                    />
                  )}
                  {entry.nickname}
                </span>
              )
            })()}
            <span className="msg-colon">: </span>
            {entry.body === 'message deleted' ? (
              <span className="italic break-words whitespace-pre-wrap text-[var(--color-faint)]">message deleted</span>
            ) : entry.nickname === 'system' ? (
              <span className="italic break-words whitespace-pre-wrap text-[var(--color-faint)]">{entry.body}</span>
            ) : (
              <span className="break-words whitespace-pre-wrap text-[var(--color-app-fg)]">{entry.body}</span>
            )}
          </div>
          {onAdminAction && (
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-faint)] opacity-0 transition hover:text-[var(--color-app-fg)] focus-visible:opacity-100 group-hover:opacity-100 cursor-pointer"
              aria-label="Message admin actions"
              onClick={() => onAdminAction(entry.id, entry.nickname)}
            >
              <FontAwesomeIcon icon={faEllipsisVertical} className="text-15" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
