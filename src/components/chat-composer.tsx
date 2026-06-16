import { useEffect, useId, useRef } from 'react'
import type { FormEventHandler, RefObject } from 'react'
type ChatComposerProps = {
  authNickname: string | null
  chatError: string | null
  chatLoading: boolean
  chatNotice: string | null
  cooldownRemaining: number | null
  disabled: boolean
  messageSending: boolean
  messageStatus: string | null
  messageBody: string
  onMessageBodyChange: (value: string) => void
  onSignOut: () => void
  onSubmit: FormEventHandler<HTMLFormElement>
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function ChatComposer({
  authNickname,
  chatError,
  chatLoading,
  chatNotice,
  cooldownRemaining,
  disabled,
  messageSending,
  messageStatus,
  messageBody,
  onMessageBodyChange,
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

  // After a send finishes, return focus to the box (it was blurred while
  // disabled, or focus moved to the Send button on click) so the next message
  // can be typed straight away. Reset the auto-grown height once it's cleared.
  const wasSendingRef = useRef(false)
  useEffect(() => {
    const finishedSending = wasSendingRef.current && !messageSending
    wasSendingRef.current = messageSending
    if (!finishedSending || disabled) {
      return
    }
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    if (messageBody === '') {
      textarea.style.height = 'auto'
    }
    textarea.focus()
  }, [messageSending, disabled, messageBody, textareaRef])

  const hasFeedback = Boolean(
    chatNotice || messageStatus || chatError || chatLoading,
  )

  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 border-t border-[var(--color-edge)] bg-[var(--color-raised)] px-4 py-4"
    >
      {/* Transient toasts (sent, cooldown, errors) sit on the right of the
          identity row so they never overlap the chat list above. */}
      <div className="mb-3 flex items-center gap-3 text-16 text-[var(--color-muted)]">
        <span className="shrink-0">
          Logged in as{' '}
          <span className="font-bold text-[var(--color-app-fg)]">
            {authNickname}
          </span>
        </span>
        <button
          type="button"
          className="shrink-0 rounded-md border border-[var(--color-edge)] px-1 py-0.5 text-15 text-[var(--color-faint)] font-bold transition-colors hover:border-[var(--color-faint)] hover:text-[var(--color-app-fg)] focus-visible:outline-none focus-visible:border-[var(--color-faint)] focus-visible:text-[var(--color-app-fg)] cursor-pointer"
          onClick={onSignOut}
        >
          Log Out
        </button>
        {hasFeedback && (
          <div className="ml-auto flex min-w-0 flex-col items-end gap-1 text-right">
            {chatNotice && (
              <div
                id={noticeId}
                className="rounded-md border border-accent-red/30 bg-danger-surface/92 px-2 py-1 text-15 leading-snug text-accent-red"
                role="status"
                aria-live="polite"
              >
                {chatNotice}
              </div>
            )}
            {chatLoading && (
              <div
                id={loadingId}
                className="rounded-md border border-[var(--color-edge)] bg-overlay/92 px-2 py-1 text-15 leading-snug text-[var(--color-faint)]"
                role="status"
                aria-live="polite"
              >
                syncing chat history…
              </div>
            )}
            {messageStatus && (
              <div
                id={messageStatusId}
                className="rounded-md border border-[var(--color-edge)] bg-overlay/92 px-2 py-1 text-15 leading-snug text-[var(--color-muted)]"
                role="status"
                aria-live="polite"
              >
                {messageStatus}
              </div>
            )}
            {chatError && (
              <div
                id={errorId}
                className="rounded-md border border-accent-red/30 bg-danger-surface/92 px-2 py-1 text-15 leading-snug text-accent-red"
                role="alert"
              >
                {chatError}
                {cooldownRemaining !== null && (
                  <span className="ml-1">({cooldownRemaining}s)</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2.5 rounded-xl border border-[var(--color-edge)] bg-[var(--color-raised2)] py-2 pl-3.5 pr-2 transition-colors focus-within:border-accent/50">
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
          placeholder="Send a message…"
          disabled={composerDisabled}
          rows={1}
          aria-invalid={Boolean(chatError)}
          aria-describedby={describedBy}
          className="max-h-40 min-h-6 flex-1 resize-none overflow-hidden bg-transparent py-1 text-18 leading-6 text-[var(--color-app-fg)] placeholder:text-[var(--color-faint)] focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={composerDisabled}
          className="inline-flex h-9 shrink-0 items-center rounded-[9px] bg-accent px-5 text-18 font-extrabold text-[var(--color-acc-ink)] transition hover:brightness-105 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {messageSending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
