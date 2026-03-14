import { useId } from 'react'
import type { FormEventHandler } from 'react'

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

  return (
    <form
      key={authMode}
      onSubmit={onSubmit}
      className="flex flex-col gap-3 border-t border-zinc-800 px-4 py-4 animate-[fadeIn_220ms_ease-out] motion-reduce:animate-none"
      aria-labelledby={titleId}
    >
      <div id={titleId} className="text-zinc-400">
        {authMode === 'login' ? 'sign in to chat' : 'create an account'}
      </div>
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
      <label htmlFor={nicknameId} className="sr-only">
        Username
      </label>
      <input
        id={nicknameId}
        value={nickname}
        onChange={(event) => onNicknameChange(event.target.value)}
        placeholder="username"
        autoComplete="username"
        aria-invalid={Boolean(authError)}
        aria-describedby={describedBy}
        disabled={authLoading}
        className="h-9 border border-zinc-700 bg-black/40 px-3 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      <label htmlFor={passwordId} className="sr-only">
        Password
      </label>
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
        className="h-9 border border-zinc-700 bg-black/40 px-3 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      <button
        type="submit"
        className="h-9 border border-zinc-700 bg-zinc-900 px-3 text-zinc-100 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
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
      <button
        type="button"
        onClick={onAuthModeToggle}
        disabled={authLoading}
        className="group inline-flex w-fit items-center gap-1 text-left text-zinc-400 transition-colors duration-200 ease-out hover:text-zinc-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 cursor-pointer"
      >
        {authMode === 'login'
          ? 'need an account? create one'
          : 'already have an account? sign in'}
        <span className="text-zinc-500 transition-colors duration-200 ease-out group-hover:text-zinc-300">
          →
        </span>
      </button>
    </form>
  )
}
