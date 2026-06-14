import { useId } from 'react'
import type { FormEventHandler } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLock, faUser } from '@fortawesome/free-solid-svg-icons'

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

  const inputClasses =
    'h-11 w-full border border-zinc-700 bg-zinc-900/40 pl-10 pr-3 text-zinc-100 placeholder:text-zinc-600 transition focus:border-sky-400/70 focus:bg-zinc-900/70 focus:outline-none focus:ring-1 focus:ring-sky-400/30 disabled:opacity-60'

  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-zinc-800 px-4 py-4"
      aria-labelledby={titleId}
    >
      <div className="rail-content flex flex-col gap-4">
        <h2 id={titleId} className="sr-only">
          Sign in or create an account
        </h2>

      <div
        role="group"
        aria-label="Authentication mode"
        className="grid grid-cols-2 gap-1 border border-zinc-800 bg-black/40 p-1"
      >
        <button
          type="button"
          onClick={() => selectMode('login')}
          aria-pressed={authMode === 'login'}
          disabled={authLoading}
          className={`h-9 text-center transition disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/40 ${
            authMode === 'login'
              ? 'bg-zinc-800 font-medium text-zinc-50 shadow-[inset_0_-2px_0_0_var(--color-accent)]'
              : 'text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300'
          }`}
        >
          sign in
        </button>
        <button
          type="button"
          onClick={() => selectMode('register')}
          aria-pressed={authMode === 'register'}
          disabled={authLoading}
          className={`h-9 text-center transition disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/40 ${
            authMode === 'register'
              ? 'bg-zinc-800 font-medium text-zinc-50 shadow-[inset_0_-2px_0_0_var(--color-accent)]'
              : 'text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-300'
          }`}
        >
          create account
        </button>
      </div>

      <p className="text-zinc-500">
        join the chat — no email or verification needed
      </p>

      {chatError && (
        <div
          id={statusId}
          className="border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-zinc-100"
          role="status"
          aria-live="polite"
        >
          {chatError}
        </div>
      )}

      <div key={authMode} className="flex flex-col gap-3 animate-[fadeIn_220ms_ease-out] motion-reduce:animate-none">
        <div className="group relative">
          <label htmlFor={nicknameId} className="sr-only">
            Username
          </label>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-sky-400">
            <FontAwesomeIcon icon={faUser} className="text-[16px]" />
          </span>
          <input
            id={nicknameId}
            value={nickname}
            onChange={(event) => onNicknameChange(event.target.value)}
            placeholder="username"
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
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-sky-400">
            <FontAwesomeIcon icon={faLock} className="text-[16px]" />
          </span>
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="password"
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
        className="h-11 bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-strong)] font-semibold text-zinc-950 shadow-lg shadow-sky-500/20 transition hover:brightness-110 hover:shadow-sky-500/30 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
        disabled={authLoading}
      >
        {authLoading
          ? 'working…'
          : authMode === 'login'
            ? 'sign in'
            : 'create account'}
      </button>

      {authLoading && (
        <div
          id={authStatusId}
          className="border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-zinc-300"
          role="status"
          aria-live="polite"
        >
          {authPendingMessage}
        </div>
      )}
      {authError && (
        <div
          id={errorId}
          className="border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-100"
          role="alert"
        >
          {authError}
        </div>
      )}
        {chatLoading && (
          <div className="text-zinc-500" role="status" aria-live="polite">
            loading recent chat…
          </div>
        )}
      </div>
    </form>
  )
}
