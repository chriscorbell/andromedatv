import andromedaIcon from '../assets/andromeda.png'
import { SystemStatusPanel } from './system-status-panel'
import type { DiagnosticsStatusPayload } from '../types/status'

type StatusPageProps = {
  diagnosticsError: string | null
  diagnosticsLoading: boolean
  diagnosticsStatus: DiagnosticsStatusPayload | null
  onRetryDiagnostics: () => void
}

export function StatusPage({
  diagnosticsError,
  diagnosticsLoading,
  diagnosticsStatus,
  onRetryDiagnostics,
}: StatusPageProps) {
  return (
    <div className="ui-body min-h-dvh bg-[#050505] text-zinc-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-4 sm:px-6">
        <header className="flex items-center gap-3 border border-zinc-800 bg-black/40 px-4 py-3 text-xs text-zinc-300">
          <img
            src={andromedaIcon}
            alt="andromeda"
            className="h-3.5 w-3.5 object-contain"
          />
          <span className="ui-header font-extrabold">andromeda</span>
          <span className="border border-zinc-700 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
            status
          </span>
          <a
            href="/"
            className="ml-auto border border-zinc-700 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-zinc-200 transition hover:border-zinc-400"
          >
            back to app
          </a>
        </header>

        <main className="flex-1 border-x border-b border-zinc-800 bg-[radial-gradient(circle_at_top,rgba(115,218,202,0.08),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] px-4 py-6 sm:px-6">
          <div className="max-w-3xl">
            <p className="text-[10px] uppercase tracking-[0.32em] text-zinc-500">
              Public diagnostics
            </p>
            <h1 className="ui-header mt-2 text-3xl font-extrabold text-zinc-100 sm:text-4xl">
              Service status
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
              This page shows the latest backend health, schedule freshness,
              chat activity, and IPTV proxy diagnostics for the live service.
            </p>
          </div>

          <SystemStatusPanel
            error={diagnosticsError}
            loading={diagnosticsLoading}
            onRetry={onRetryDiagnostics}
            status={diagnosticsStatus}
          />
        </main>
      </div>
    </div>
  )
}
