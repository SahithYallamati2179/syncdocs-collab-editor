'use client'

/**
 * Client-side instrumentation.
 *
 * The mentor guidelines for this project ask about cursor latency, convergence
 * under partition, and CRDT memory footprint over long document lifetimes.
 * Those are measurements, not features, so the app records them as it runs and
 * the /lab route reads them back. Everything here is in-memory and bounded.
 */

const MAX_SAMPLES = 600
const MAX_EVENTS = 200

export type EventKind = 'connect' | 'disconnect' | 'sync' | 'partition' | 'info' | 'error'

export interface LatencySample {
  t: number
  ms: number
  from: string
}

export interface FootprintSample {
  t: number
  bytes: number
  chars: number
  items: number
}

export interface TimelineEvent {
  t: number
  kind: EventKind
  message: string
}

export interface MetricsSnapshot {
  version: number
  status: 'connecting' | 'connected' | 'disconnected'
  synced: boolean
  peers: number
  /** Wall-clock ms from reconnect to the provider reporting a synced state. */
  lastConvergenceMs: number | null
  /** Local edits queued while the socket was down, flushed on reconnect. */
  offlineEdits: number
  /** Most recent server round-trip time, in ms. */
  roundTripMs: number | null
  /** Artificial egress delay currently injected, in ms. */
  lagMs: number
  /** Set when the server refused this document; null when access is fine. */
  accessError: string | null
  latency: LatencySample[]
  roundTrip: LatencySample[]
  footprint: FootprintSample[]
  events: TimelineEvent[]
}

type Listener = () => void

const listeners = new Set<Listener>()

const state = {
  version: 0,
  status: 'connecting' as MetricsSnapshot['status'],
  synced: false,
  peers: 0,
  lastConvergenceMs: null as number | null,
  offlineEdits: 0,
  roundTripMs: null as number | null,
  lagMs: 0,
  accessError: null as string | null,
  latency: [] as LatencySample[],
  roundTrip: [] as LatencySample[],
  footprint: [] as FootprintSample[],
  events: [] as TimelineEvent[],
}

let cached: MetricsSnapshot | null = null

function emit(): void {
  state.version += 1
  cached = null
  listeners.forEach((listener) => listener())
}

function push<T>(list: T[], item: T, cap: number): T[] {
  list.push(item)
  if (list.length > cap) list.splice(0, list.length - cap)
  return list
}

export const metrics = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  getSnapshot(): MetricsSnapshot {
    if (!cached) {
      cached = {
        version: state.version,
        status: state.status,
        synced: state.synced,
        peers: state.peers,
        lastConvergenceMs: state.lastConvergenceMs,
        offlineEdits: state.offlineEdits,
        roundTripMs: state.roundTripMs,
        lagMs: state.lagMs,
        accessError: state.accessError,
        latency: state.latency.slice(),
        roundTrip: state.roundTrip.slice(),
        footprint: state.footprint.slice(),
        events: state.events.slice(),
      }
    }
    return cached
  },

  /** Server-rendered snapshot: useSyncExternalStore needs a stable empty value. */
  getServerSnapshot(): MetricsSnapshot {
    return EMPTY_SNAPSHOT
  },

  setStatus(status: MetricsSnapshot['status']): void {
    if (state.status === status) return
    state.status = status
    emit()
  },

  setSynced(synced: boolean): void {
    if (state.synced === synced) return
    state.synced = synced
    emit()
  },

  setPeers(peers: number): void {
    if (state.peers === peers) return
    state.peers = peers
    emit()
  },

  setConvergence(ms: number): void {
    state.lastConvergenceMs = ms
    emit()
  },

  setOfflineEdits(count: number): void {
    if (state.offlineEdits === count) return
    state.offlineEdits = count
    emit()
  },

  recordLatency(ms: number, from: string): void {
    // Awareness timestamps come from the peer's clock. Across two tabs on one
    // machine that is exact; across machines it carries their clock skew, so
    // obviously impossible values are dropped rather than plotted.
    if (!Number.isFinite(ms) || ms < 0 || ms > 10_000) return
    push(state.latency, { t: Date.now(), ms, from }, MAX_SAMPLES)
    emit()
  },

  /**
   * A true round trip: the client stamped its own clock and the server echoed
   * the payload back, so unlike presence latency this carries no clock skew and
   * needs no second user present.
   */
  recordRoundTrip(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0 || ms > 30_000) return
    state.roundTripMs = ms
    push(state.roundTrip, { t: Date.now(), ms, from: 'server' }, MAX_SAMPLES)
    emit()
  },

  setLag(ms: number): void {
    if (state.lagMs === ms) return
    state.lagMs = ms
    emit()
  },

  setAccessError(message: string | null): void {
    if (state.accessError === message) return
    state.accessError = message
    emit()
  },

  recordFootprint(bytes: number, chars: number, items: number): void {
    push(state.footprint, { t: Date.now(), bytes, chars, items }, MAX_SAMPLES)
    emit()
  },

  recordEvent(kind: EventKind, message: string): void {
    push(state.events, { t: Date.now(), kind, message }, MAX_EVENTS)
    emit()
  },

  reset(): void {
    state.latency = []
    state.roundTrip = []
    state.footprint = []
    state.events = []
    state.lastConvergenceMs = null
    state.offlineEdits = 0
    state.roundTripMs = null
    state.accessError = null
    emit()
  },
}

const EMPTY_SNAPSHOT: MetricsSnapshot = {
  version: 0,
  status: 'connecting',
  synced: false,
  peers: 0,
  lastConvergenceMs: null,
  offlineEdits: 0,
  roundTripMs: null,
  lagMs: 0,
  accessError: null,
  latency: [],
  roundTrip: [],
  footprint: [],
  events: [],
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}
