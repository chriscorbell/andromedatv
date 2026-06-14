import { useId } from 'react'
import type { FormEventHandler, RefObject } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPaperPlane, faShield } from '@fortawesome/free-solid-svg-icons'

type ChatComposerProps = {
  authIsAdmin: boolean
  chatError: string | null
  chatLoading: boolean
  chatNotice: string | null
  cooldownRemaining: number | null
  disabled: boolean
  messageSending: boolean
  messageStatus: string | null
  messageBody: string
  onMessageBodyChange: (value: string) => void
  onOpenAdminMenu: () => void
  onSignOut: () => void
  onSubmit: FormEventHandler<HTMLFormElement>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function ChatComposer({
  authIsAdmin,
  chatError,
  chatLoading,
  chatNotice,
  cooldownRemaining,
  disabled,
  messageSending,
  messageStatus,
  messageBody,
  onMessageBodyChange,
  onOpenAdminMenu,
  onSignOut,
  onSubmit,
  textareaRef,
}: ChatComposerProps) {
  const messageId = useId()
  const noticeId = useId()
  const errorId = useId()
  const loadingId = useId()
  const messageStatusId = useId()
  const describedBy = [
    chatNotice ? noticeId : null,
    chatError ? errorId : null,
    chatLoading ? loadingId : null,
    messageStatus ? messageStatusId : null,
  ].filter(Boolean).join(' ') || undefined
  const composerDisabled = disabled || messageSending

  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-zinc-800 px-4 py-3"
    >
      {chatNotice && (
        <div
          id={noticeId}
          className="mb-2 text-[var(--color-accent-red)]"
          role="status"
          aria-live="polite"
        >
          {chatNotice}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor={messageId} className="sr-only">
          Chat message
        </label>
        <textarea
          id={messageId}
          ref={textareaRef}
          value={messageBody}
          onChange={(event) => {
            onMessageBodyChange(event.target.value)
            event.target.style.height = 'auto'
            event.target.style.height = `${event.target.scrollHeight}px`
          }}
          onPaste={(event) => {
            event.preventDefault()
            const pasted = event.clipboardData
              .getData('text')
              .replace(/[\r\n]+/g, ' ')
            const target = event.currentTarget
            const start = target.selectionStart ?? 0
            const end = target.selectionEnd ?? start
            const nextValue =
              target.value.slice(0, start) +
              pasted +
              target.value.slice(end)

            onMessageBodyChange(nextValue)

            const caretPosition = start + pasted.length
            requestAnimationFrame(() => {
              target.setSelectionRange(caretPosition, caretPosition)
              target.style.height = 'auto'
              target.style.height = `${target.scrollHeight}px`
            })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="Type a message"
          disabled={composerDisabled}
          rows={1}
          aria-invalid={Boolean(chatError)}
          aria-describedby={describedBy}
          className="max-h-64 min-h-9 flex-1 resize-none overflow-hidden border border-zinc-700 bg-zinc-900/40 px-3 py-2 leading-6 text-zinc-100 placeholder:text-zinc-600 transition focus:border-sky-400/70 focus:bg-zinc-900/70 focus:outline-none focus:ring-1 focus:ring-sky-400/30 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={composerDisabled}
          className="inline-flex min-h-9 items-center gap-2 border border-transparent bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-strong)] px-4 py-2 font-semibold leading-6 text-zinc-950 shadow-lg shadow-sky-500/20 transition hover:brightness-110 hover:shadow-sky-500/30 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:brightness-100"
        >
          <FontAwesomeIcon
            icon={faPaperPlane}
            className="text-[13px]"
            aria-hidden="true"
          />
          {messageSending ? 'sending…' : 'send'}
        </button>
      </div>
      {messageStatus && (
        <div
          id={messageStatusId}
          className="mt-2 text-zinc-400"
          role="status"
          aria-live="polite"
        >
          {messageStatus}
        </div>
      )}
      {chatError && (
        <div
          id={errorId}
          className="mt-2 border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-100"
          role="alert"
        >
          {chatError}
          {cooldownRemaining !== null && (
            <span className="ml-1 text-[var(--color-accent-red)]">
              ({cooldownRemaining}s)
            </span>
          )}
        </div>
      )}
      {chatLoading && (
        <div
          id={loadingId}
          className="mt-2 text-zinc-500"
          role="status"
          aria-live="polite"
        >
          syncing chat history…
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-zinc-500">
        <button
          type="button"
          className="text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/40"
          onClick={onSignOut}
        >
          sign out
        </button>
        {authIsAdmin ? (
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center text-zinc-400 transition hover:text-sky-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/40 cursor-pointer"
            onClick={onOpenAdminMenu}
            aria-label="Open admin menu"
          >
            <FontAwesomeIcon icon={faShield} className="text-[16px]" />
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
    </form>
  )
}
