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
        className={`w-full max-w-lg rounded-xl border border-[var(--color-edge)] bg-[var(--color-pane)] p-6 text-[var(--color-app-fg)] shadow-2xl transition duration-200 ${active ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="ui-header font-bold">About</div>
          <button
            type="button"
            className="info-btn inline-flex h-7 w-7 items-center justify-center cursor-pointer"
            onClick={onClose}
            aria-label="Close info"
          >
            <FontAwesomeIcon icon={faXmark} className="text-[16px]" />
          </button>
        </div>
        <div>
          <p className="prose-body mt-3 text-[var(--color-muted)]">
            Andromeda is a 24/7 livestream of 80s & 90s anime (primarily
            mecha and cyberpunk), with a live schedule and community chat.
          </p>
          <p className="prose-body mt-3 text-[var(--color-muted)]">
            Log in or create an account to join the chat. No email or
            verification needed. Passwords are securely hashed and salted
            before they get stored in the database.
          </p>
          <p className="prose-body mt-3 text-[var(--color-muted)]">
            Powered by Docker, TypeScript, React, Vite, TailwindCSS,
            Bun, SQLite, ErsatzTV and Jellyfin.
          </p>
          <p className="mt-3 text-[var(--color-muted)]">
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
