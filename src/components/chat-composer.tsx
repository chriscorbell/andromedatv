import { useId } from 'react'
import type { FormEventHandler, RefObject } from 'react'

type ChatComposerProps = {
  authIsAdmin: boolean
  chatError: string | null
  chatLoading: boolean
  chatNotice: string | null
  cooldownRemaining: number | null
  disabled: boolean
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
  const describedBy = [
    chatNotice ? noticeId : null,
    chatError ? errorId : null,
    chatLoading ? loadingId : null,
  ].filter(Boolean).join(' ') || undefined

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
          disabled={disabled}
          rows={1}
          aria-invalid={Boolean(chatError)}
          aria-describedby={describedBy}
          className="max-h-64 min-h-9 flex-1 resize-none overflow-hidden border border-zinc-700 bg-black/40 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled}
          className="h-9 border border-zinc-700 bg-zinc-900 px-3 text-zinc-100 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          send
        </button>
      </div>
      {chatError && (
        <div
          id={errorId}
          className="mt-2 text-[var(--color-accent-red)]"
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
          updating…
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-zinc-500">
        <button
          type="button"
          className="text-zinc-400 hover:text-zinc-200"
          onClick={onSignOut}
        >
          sign out
        </button>
        {authIsAdmin ? (
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center text-zinc-400 transition hover:text-zinc-200 cursor-pointer"
            onClick={onOpenAdminMenu}
            aria-label="Open admin menu"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l7 3v6c0 4.2-2.9 8-7 9-4.1-1-7-4.8-7-9V6l7-3z" />
              <path d="M9.5 12.5l1.7 1.7 3.3-3.3" />
            </svg>
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
    </form>
  )
}
