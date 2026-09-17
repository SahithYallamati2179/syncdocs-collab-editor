'use client'

import type { CollabSession } from '@/lib/collab'
import type { MetricsSnapshot } from '@/lib/metrics'

interface StatusStripProps {
  session: CollabSession | null
  snapshot: MetricsSnapshot
}

const LAG_MS = 400

/**
 * The connection line from the design, with the three simulation triggers
 * wired to the real transport rather than to a mock.
 */
export function StatusStrip({ session, snapshot }: StatusStripProps) {
  const { status, synced, offlineEdits, roundTripMs, lagMs } = snapshot

  let tone: 'good' | 'warn' | 'danger' = 'good'
  let message = 'Connected · All changes synced'

  if (status === 'connecting') {
    tone = 'warn'
    message = 'Reconnecting · edits are held locally'
  } else if (status === 'disconnected') {
    tone = 'danger'
    message =
      offlineEdits > 0
        ? `Offline · ${offlineEdits} edit${offlineEdits === 1 ? '' : 's'} queued for merge`
        : 'Offline · editing locally'
  } else if (!synced) {
    tone = 'warn'
    message = 'Connected · syncing document'
  } else if (lagMs > 0) {
    tone = 'warn'
    message = `Connected · ${lagMs}ms of simulated lag`
  }

  const latencyLabel =
    roundTripMs === null
      ? '(measuring round trip…)'
      : `(WebSocket ${Math.round(roundTripMs)}ms round trip)`

  return (
    <div className="strip">
      <span className="strip__msg">
        <span className={`dot dot--${tone}`} aria-hidden />
        <span role="status" aria-live="polite">
          {message}
        </span>
      </span>
      <span className="strip__latency">{latencyLabel}</span>

      <span className="strip__sim">
        <span className="strip__simlabel">Simulate:</span>
        <button
          type="button"
          className="sim-chip"
          disabled={!session || status !== 'connected'}
          onClick={() => session?.forceSync()}
          title="Re-run the sync protocol against the server"
        >
          Sync
        </button>
        <button
          type="button"
          className="sim-chip"
          data-tone="warn"
          data-on={lagMs > 0 ? 'true' : 'false'}
          disabled={!session}
          onClick={() => session?.setLag(lagMs > 0 ? 0 : LAG_MS)}
          title={`Inject ${LAG_MS}ms of delay into outgoing messages`}
        >
          Lag
        </button>
        <button
          type="button"
          className="sim-chip"
          data-tone="danger"
          data-on={status === 'disconnected' ? 'true' : 'false'}
          disabled={!session}
          onClick={() =>
            status === 'disconnected' ? session?.reconnect() : session?.disconnect()
          }
          title="Close the WebSocket to simulate a network partition"
        >
          {status === 'disconnected' ? 'Reconnect' : 'Offline'}
        </button>
      </span>
    </div>
  )
}
