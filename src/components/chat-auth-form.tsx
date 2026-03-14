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
  return (
    <form
      key={authMode}
      onSubmit={onSubmit}
      className="flex flex-col gap-3 border-t border-zinc-800 px-4 py-4 animate-[fadeIn_220ms_ease-out] motion-reduce:animate-none"
    >
      <div className="text-zinc-400">
        {authMode === 'login' ? 'sign in to chat' : 'create an account'}
      </div>
      {chatError && (
        <div className="text-[var(--color-accent-red)]">
          {chatError}
        </div>
      )}
      <input
        value={nickname}
        onChange={(event) => onNicknameChange(event.target.value)}
        placeholder="username"
        className="h-9 border border-zinc-700 bg-black/40 px-3 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      <input
        type="password"
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
        placeholder="password"
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
      {authError && (
        <div className="text-[var(--color-accent-red)]">{authError}</div>
      )}
      {chatLoading && (
        <div className="text-zinc-500">updating…</div>
      )}
      <button
        type="button"
        onClick={onAuthModeToggle}
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
