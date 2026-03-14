type AboutModalProps = {
  active: boolean
  onClose: () => void
  visible: boolean
}

export function AboutModal({
  active,
  onClose,
  visible,
}: AboutModalProps) {
  if (!visible) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 transition-opacity duration-200 ${active ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg border border-zinc-800 bg-[#050505] p-6 text-zinc-200 shadow-xl transition duration-200 ${active ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="ui-header font-extrabold">about</div>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center text-zinc-500 transition hover:text-zinc-200 cursor-pointer"
            onClick={onClose}
            aria-label="Close info"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12" />
              <path d="M18 6l-12 12" />
            </svg>
          </button>
        </div>
        <div>
          <p className="mt-3 text-zinc-400">
            andromeda is a 24/7 livestream of 80s & 90s anime (primarily
            mecha and cyberpunk), with a live schedule and community chat.
          </p>
          <p className="mt-3 text-zinc-400">
            sign in or create an account to join the chat. no email or
            verification needed. passwords are securely hashed and salted
            before they get stored in the database.
          </p>
          <p className="mt-3 text-zinc-400">
            powered by docker, typescript, react, vite, tailwindcss,
            bun, sqlite, ersatztv and jellyfin.
          </p>
          <p className="mt-3 text-zinc-400">
            <a
              href="https://github.com/chriscorbell/andromedatv"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
              title="view on github"
              className="inline-flex items-center text-[#73daca] underline decoration-dashed underline-offset-4 transition hover:text-[#a6f3d1]"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2a10 10 0 00-3.16 19.48c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.2-3.37-1.2-.46-1.16-1.12-1.47-1.12-1.47-.92-.62.07-.6.07-.6 1.01.08 1.54 1.05 1.54 1.05.9 1.52 2.36 1.08 2.94.82.1-.64.35-1.08.64-1.33-2.22-.24-4.56-1.1-4.56-4.95 0-1.1.4-2.02 1.05-2.73-.1-.26-.46-1.32.1-2.76 0 0 .86-.28 2.8 1.04A9.7 9.7 0 0112 6.8c.85 0 1.72.12 2.52.34 1.94-1.32 2.8-1.04 2.8-1.04.56 1.44.2 2.5.1 2.76.66.7 1.05 1.62 1.05 2.73 0 3.86-2.34 4.7-4.58 4.94.36.3.68.9.68 1.82v2.7c0 .26.18.58.68.48A10 10 0 0012 2z"
                />
              </svg>
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
