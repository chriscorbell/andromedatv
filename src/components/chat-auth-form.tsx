import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEventHandler } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faLock, faUser } from '@fortawesome/free-solid-svg-icons'

// Structural rows fade up in sequence so a view assembles instead of snapping
// in. Indices are cascade positions; the `both` fill keeps later rows hidden
// until their turn, and motion-reduce drops the motion entirely. Strings are
// spelled out in full so Tailwind's scanner can see them.
const stagger = [
  'animate-[fadeIn_260ms_ease-out_both] motion-reduce:animate-none',
  'animate-[fadeIn_260ms_ease-out_70ms_both] motion-reduce:animate-none',
  'animate-[fadeIn_260ms_ease-out_140ms_both] motion-reduce:animate-none',
  'animate-[fadeIn_260ms_ease-out_210ms_both] motion-reduce:animate-none',
] as const

// For blocks that appear in response to an action (status/error) rather than as
// part of the initial reveal — a plain fade with no stagger delay.
const revealNow = 'animate-[fadeIn_200ms_ease-out] motion-reduce:animate-none'

// Mode-dependent labels (title, submit, toggle link) crossfade when switching
// between sign-in and create-account instead of swapping instantly. Apply to a
// span keyed by authMode so React remounts it and the fade re-runs each toggle.
const swap = 'animate-[fadeSwap_200ms_ease-out] motion-reduce:animate-none'

type ChatAuthFormProps = {
  authError: string | null
  authLoading: boolean
  authMode: 'login' | 'register'
  chatError: string | null
  chatLoading: boolean
  nickname: string
  onAuthModeToggle: () => void
  onNicknameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
  password: string
}

export function ChatAuthForm({
  authError,
  authLoading,
  authMode,
  chatError,
  chatLoading,
  nickname,
  onAuthModeToggle,
  onNicknameChange,
  onPasswordChange,
  onSubmit,
  password,
}: ChatAuthFormProps) {
  const titleId = useId()
  const nicknameId = useId()
  const passwordId = useId()
  const statusId = useId()
  const errorId = useId()
  const authStatusId = useId()
  // Open the credential form straight away if an attempt is already underway
  // (loading or carrying an error); otherwise start on the two-button choice.
  const [showForm, setShowForm] = useState(
    () => authLoading || Boolean(authError),
  )

  // Smoothly grow/shrink the panel as its content changes height (e.g. switching
  // from the two-button choice to the taller credential form, or when an
  // error/status row appears). We measure with a FLIP: pin the previous height,
  // then transition to the freshly-rendered one. Runs before paint so the jump
  // is never visible. Honours prefers-reduced-motion by skipping the animation.
  const contentRef = useRef<HTMLDivElement | null>(null)
  const previousHeight = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    const nextHeight = el.offsetHeight
    const prev = previousHeight.current
    previousHeight.current = nextHeight

    // Nothing to animate on first render or when the height is unchanged.
    if (prev === null || prev === nextHeight) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    el.style.height = `${prev}px`
    el.style.overflow = 'hidden'
    void el.offsetHeight // force reflow so the start height registers
    el.style.height = `${nextHeight}px`

    const handleEnd = (event: TransitionEvent) => {
      if (event.propertyName !== 'height') return
      el.style.height = ''
      el.style.overflow = ''
      el.removeEventListener('transitionend', handleEnd)
    }
    el.addEventListener('transitionend', handleEnd)

    return () => {
      el.removeEventListener('transitionend', handleEnd)
      el.style.height = ''
      el.style.overflow = ''
    }
  }, [showForm, authMode, authLoading, authError, chatError, chatLoading])

  const describedBy = [
    chatError ? statusId : null,
    authError ? errorId : null,
    authLoading ? authStatusId : null,
  ].filter(Boolean).join(' ') || undefined
  const authPendingMessage =
    authMode === 'login'
      ? 'Signing you into chat...'
      : 'Creating your account...'

  const selectMode = (mode: 'login' | 'register') => {
    if (mode !== authMode) {
      onAuthModeToggle()
    }
  }

  const openForm = (mode: 'login' | 'register') => {
    selectMode(mode)
    setShowForm(true)
  }

  const chatErrorBanner = chatError ? (
    <div
      id={statusId}
      className={`rounded-lg border border-accent/30 bg-[var(--color-acc-tint)] px-3 py-2 text-18 text-[var(--color-app-fg)] ${stagger[1]}`}
      role="status"
      aria-live="polite"
    >
      {chatError}
    </div>
  ) : null

  const inputClasses =
    'h-11 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-raised2)] pl-10 pr-3 text-18 text-[var(--color-app-fg)] placeholder:text-[var(--color-faint)] transition focus:border-accent/50 focus:outline-none disabled:opacity-60'

  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 border-t border-[var(--color-edge)] bg-[var(--color-raised)] px-4 py-4"
      aria-labelledby={titleId}
    >
      <h2 id={titleId} className="sr-only">
        Log in or create an account
      </h2>

      <div className="rail-content">
        <div
          ref={contentRef}
          className="transition-[height] duration-300 ease-out motion-reduce:transition-none"
        >
          <div
            key={showForm ? 'form' : 'choice'}
            className="flex flex-col gap-4"
          >
            {!showForm ? (
              <>
                <div className={stagger[0]}>
                  <div className="text-20 font-bold text-[var(--color-app-fg)]">
                    Join the conversation.
                  </div>
                  <p className="mt-0.5 text-18 text-[var(--color-muted)]">
                    Log in to chat. No email or verification needed.
                  </p>
                </div>

                {chatErrorBanner}

                <div className={`flex gap-2.5 ${stagger[1]}`}>
                  <button
                    type="button"
                    onClick={() => openForm('login')}
                    className="h-10 flex-1 rounded-lg bg-accent text-18 font-bold text-[var(--color-acc-ink)] transition hover:brightness-105 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    Log In
                  </button>
                  <button
                    type="button"
                    onClick={() => openForm('register')}
                    className="h-10 flex-1 rounded-lg border border-[var(--color-edge)] text-18 font-bold text-[var(--color-app-fg)] transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    Create Account
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={`flex items-center gap-2 ${stagger[0]}`}>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    aria-label="Back"
                    className="info-btn -ml-1 inline-flex h-7 w-7 items-center justify-center cursor-pointer"
                  >
                    <FontAwesomeIcon icon={faChevronLeft} className="text-15" />
                  </button>
                  <div className="text-20 font-bold text-[var(--color-app-fg)]">
                    <span key={authMode} className={swap}>
                      {authMode === 'login' ? 'Log In' : 'Create Account'}
                    </span>
                  </div>
                </div>

                {chatErrorBanner}

                <div className={`flex flex-col gap-3 ${stagger[1]}`}>
                  <div className="group relative">
                    <label htmlFor={nicknameId} className="sr-only">
                      Username
                    </label>
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-faint)] transition-colors group-focus-within:text-[var(--color-accent)]">
                      <FontAwesomeIcon icon={faUser} className="text-15" />
                    </span>
                    <input
                      id={nicknameId}
                      value={nickname}
                      onChange={(event) => onNicknameChange(event.target.value)}
                      placeholder="Username"
                      autoComplete="username"
                      aria-invalid={Boolean(authError)}
                      aria-describedby={describedBy}
                      disabled={authLoading}
                      className={inputClasses}
                    />
                  </div>
                  <div className="group relative">
                    <label htmlFor={passwordId} className="sr-only">
                      Password
                    </label>
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-faint)] transition-colors group-focus-within:text-[var(--color-accent)]">
                      <FontAwesomeIcon icon={faLock} className="text-15" />
                    </span>
                    <input
                      id={passwordId}
                      type="password"
                      value={password}
                      onChange={(event) => onPasswordChange(event.target.value)}
                      placeholder="Password"
                      autoComplete={
                        authMode === 'login' ? 'current-password' : 'new-password'
                      }
                      aria-invalid={Boolean(authError)}
                      aria-describedby={describedBy}
                      disabled={authLoading}
                      className={inputClasses}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className={`h-11 rounded-lg bg-accent text-18 font-extrabold text-[var(--color-acc-ink)] transition hover:brightness-105 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60 ${stagger[2]}`}
                  disabled={authLoading}
                >
                  <span key={authMode} className={swap}>
                    {authLoading
                      ? 'Working…'
                      : authMode === 'login'
                        ? 'Log In'
                        : 'Create Account'}
                  </span>
                </button>

                {authLoading && (
                  <div
                    id={authStatusId}
                    className={`rounded-lg border border-[var(--color-edge)] bg-[var(--color-raised2)] px-3 py-2 text-18 text-[var(--color-muted)] ${revealNow}`}
                    role="status"
                    aria-live="polite"
                  >
                    {authPendingMessage}
                  </div>
                )}
                {authError && (
                  <div
                    id={errorId}
                    className={`rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-18 text-accent-red ${revealNow}`}
                    role="alert"
                  >
                    {authError}
                  </div>
                )}
                {chatLoading && (
                  <div className="text-18 text-[var(--color-faint)]" role="status" aria-live="polite">
                    loading recent chat…
                  </div>
                )}

                <button
                  type="button"
                  onClick={() =>
                    selectMode(authMode === 'login' ? 'register' : 'login')
                  }
                  disabled={authLoading}
                  className={`group self-start text-16 text-[var(--color-muted)] disabled:opacity-60 focus-visible:outline-none ${stagger[3]}`}
                >
                  <span key={authMode} className={swap}>
                    {authMode === 'login' ? (
                      <>
                        First time here?{' '}
                        <span className="font-semibold text-[var(--color-accent)] underline-offset-2 transition group-hover:underline group-hover:brightness-110 group-focus-visible:underline">
                          Create Account
                        </span>
                      </>
                    ) : (
                      <>
                        Already have an account?{' '}
                        <span className="font-semibold text-[var(--color-accent)] underline-offset-2 transition group-hover:underline group-hover:brightness-110 group-focus-visible:underline">
                          Log In
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
