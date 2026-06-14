import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { faGithub } from '@fortawesome/free-brands-svg-icons'

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
            <FontAwesomeIcon icon={faXmark} className="text-[16px]" />
          </button>
        </div>
        <div>
          <p className="prose-body mt-3 text-zinc-400">
            andromeda is a 24/7 livestream of 80s & 90s anime (primarily
            mecha and cyberpunk), with a live schedule and community chat.
          </p>
          <p className="prose-body mt-3 text-zinc-400">
            sign in or create an account to join the chat. no email or
            verification needed. passwords are securely hashed and salted
            before they get stored in the database.
          </p>
          <p className="prose-body mt-3 text-zinc-400">
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
              className="inline-flex items-center text-[var(--color-accent)] underline decoration-dashed underline-offset-4 transition hover:text-[var(--color-accent-strong)]"
            >
              <FontAwesomeIcon icon={faGithub} className="text-[20px]" />
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
