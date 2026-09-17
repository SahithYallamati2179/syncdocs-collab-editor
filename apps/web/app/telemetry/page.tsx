'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { AppShell } from '@/components/AppShell'
import { ChartLegend, LineChart, type ChartSeries } from '@/components/LineChart'
import { StatusStrip } from '@/components/StatusStrip'
import type { CollabSession } from '@/lib/collab'
import { isValidDocumentId, useServerStats } from '@/lib/documents'
import { Icon } from '@/lib/icons'
import {
  formatBytes,
  formatNumber,
  percentile,
  type MetricsSnapshot,
} from '@/lib/metrics'

const DEFAULT_DOC = 'lab-scratch'

/** Trailing window used for the rolling percentile lines. */
const WINDOW = 20

const LOREM =
  'The quick brown fox jumps over the lazy dog while the sync protocol quietly reconciles every divergent replica. '

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <div className="tile__label">{label}</div>
      <div className="tile__value">{value}</div>
      {hint && <div className="tile__hint">{hint}</div>}
    </div>
  )
}

function TelemetryView({
  session,
  snapshot,
}: {
  session: CollabSession | null
  snapshot: MetricsSnapshot
}) {
  const stats = useServerStats()
  const [busy, setBusy] = useState<string | null>(null)

  const latest = snapshot.footprint[snapshot.footprint.length - 1] ?? null
  const latencyValues = snapshot.latency.map((sample) => sample.ms)
  const rttValues = snapshot.roundTrip.map((sample) => sample.ms)

  const latencySeries = useMemo<ChartSeries[]>(() => {
    if (snapshot.latency.length < 2) return []
    const p50: { x: number; y: number }[] = []
    const p95: { x: number; y: number }[] = []

    snapshot.latency.forEach((sample, index) => {
      const window = snapshot.latency
        .slice(Math.max(0, index - WINDOW + 1), index + 1)
        .map((entry) => entry.ms)
      p50.push({ x: sample.t, y: percentile(window, 50) ?? 0 })
      p95.push({ x: sample.t, y: percentile(window, 95) ?? 0 })
    })

    return [
      { id: 'p50', label: 'p50', color: 'var(--series-1)', points: p50 },
      { id: 'p95', label: 'p95', color: 'var(--series-2)', points: p95 },
    ]
  }, [snapshot.latency])

  const rttSeries = useMemo<ChartSeries[]>(() => {
    if (snapshot.roundTrip.length < 2) return []
    return [
      {
        id: 'rtt',
        label: 'Round trip',
        color: 'var(--series-1)',
        points: snapshot.roundTrip.map((sample) => ({ x: sample.t, y: sample.ms })),
      },
    ]
  }, [snapshot.roundTrip])

  const footprintSeries = useMemo<ChartSeries[]>(() => {
    const points = snapshot.footprint
      .filter((sample) => sample.chars > 0)
      .map((sample) => ({ x: sample.chars, y: sample.bytes }))
    if (points.length < 2) return []
    return [{ id: 'bytes', label: 'Encoded state', color: 'var(--series-1)', points }]
  }, [snapshot.footprint])

  const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))

  /**
   * The load generators write straight into the Y.Doc rather than through an
   * editor instance. That keeps this view independent of whether an editor is
   * mounted, and it exercises the same path a remote peer's updates take —
   * which is the path the measurements are about. Character counting comes from
   * the fragment itself for the same reason.
   */
  const appendParagraph = (session: CollabSession, text: string) => {
    const fragment = session.doc.getXmlFragment('default')
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText(text)])
    fragment.insert(fragment.length, [paragraph])
  }

  const countCharacters = (session: CollabSession): number => {
    let total = 0
    session.doc
      .getXmlFragment('default')
      .toArray()
      .forEach((node) => {
        total += node.toString().replace(/<[^>]+>/g, '').length
      })
    return total
  }

  /**
   * Insert in chunks rather than in one transaction. A single 10k-character
   * transaction blocks the main thread long enough to distort the latency
   * numbers we are trying to read.
   */
  const insertBulk = useCallback(
    async (totalChars: number) => {
      if (!session) return
      setBusy('insert')
      const chunk = LOREM.repeat(Math.ceil(1000 / LOREM.length)).slice(0, 1000)
      for (let index = 0; index < Math.ceil(totalChars / 1000); index += 1) {
        appendParagraph(session, chunk)
        session.reportCharCount(countCharacters(session))
        await yieldToBrowser()
      }
      setBusy(null)
    },
    [session],
  )

  /**
   * Type-then-delete churn. Character count returns to where it started while
   * the encoded state does not: the difference is tombstones, which is the
   * long-document memory question made visible.
   */
  const churn = useCallback(async () => {
    if (!session) return
    setBusy('churn')
    const chunk = LOREM.slice(0, 200)
    const fragment = session.doc.getXmlFragment('default')

    for (let index = 0; index < 25; index += 1) {
      appendParagraph(session, chunk)
      await yieldToBrowser()
      if (fragment.length > 0) fragment.delete(fragment.length - 1, 1)
      session.reportCharCount(countCharacters(session))
      await yieldToBrowser()
    }
    setBusy(null)
  }, [session])

  const stateVectorBytes = session ? Y.encodeStateVector(session.doc).byteLength : 0

  return (
    <div className="editor-col">
      <StatusStrip session={session} snapshot={snapshot} />

      <div className="telemetry">
        <h1 style={{ fontSize: 24, letterSpacing: '-0.025em', margin: '6px 0 4px' }}>
          Measurements, not assertions
        </h1>
        <p style={{ color: 'var(--ink-3)', maxWidth: '64ch', marginTop: 0, fontSize: 13 }}>
          Recorded by the running app: server round-trip time, presence latency between peers,
          encoded CRDT size against document length, and how long convergence takes after a
          simulated partition.
        </p>

        <h2 className="section-title">Load generators</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={() => insertBulk(10_000)}
            disabled={!session || busy !== null}
          >
            <Icon name="plus" size={14} />
            {busy === 'insert' ? 'Inserting…' : 'Insert 10k characters'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={churn}
            disabled={!session || busy !== null}
          >
            <Icon name="trash" size={14} />
            {busy === 'churn' ? 'Churning…' : 'Churn 5k (type then delete)'}
          </button>
        </div>
        <p style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>
          These write directly into the shared document, so the editor tab sees them arrive exactly
          as a remote peer&rsquo;s edits would. Use the simulation chips above to cut the
          connection, add lag, or force a resync.
        </p>

        <h2 className="section-title">Now</h2>
        <div className="tiles">
          <Tile
            label="Encoded state"
            value={latest ? formatBytes(latest.bytes) : '—'}
            hint={`state vector ${formatBytes(stateVectorBytes)}`}
          />
          <Tile
            label="Characters"
            value={latest ? formatNumber(latest.chars) : '—'}
            hint={
              latest && latest.chars > 0
                ? `${(latest.bytes / latest.chars).toFixed(2)} bytes per character`
                : 'type to populate'
            }
          />
          <Tile
            label="Yjs structs"
            value={latest ? formatNumber(latest.items) : '—'}
            hint="live items plus tombstones"
          />
          <Tile
            label="Server round trip"
            value={
              snapshot.roundTripMs !== null ? `${Math.round(snapshot.roundTripMs)} ms` : '—'
            }
            hint={
              rttValues.length > 0
                ? `p95 ${Math.round(percentile(rttValues, 95) ?? 0)} ms over ${rttValues.length} pings`
                : 'measuring…'
            }
          />
          <Tile
            label="Presence p50"
            value={
              latencyValues.length > 0
                ? `${Math.round(percentile(latencyValues, 50) ?? 0)} ms`
                : '—'
            }
            hint={
              latencyValues.length > 0
                ? `${latencyValues.length} samples from peers`
                : 'needs a second window'
            }
          />
          <Tile
            label="Last convergence"
            value={
              snapshot.lastConvergenceMs !== null ? `${snapshot.lastConvergenceMs} ms` : '—'
            }
            hint="partition start to synced"
          />
        </div>

        <h2 className="section-title">Charts</h2>
        <div className="charts">
          <div className="chart-card">
            <div className="chart-card__head">
              <div>
                <div className="chart-card__title">Server round trip</div>
                <div className="chart-card__sub">Stateless ping echoed by the sync server</div>
              </div>
            </div>
            <LineChart
              series={rttSeries}
              formatX={(value) => new Date(value).toLocaleTimeString()}
              formatY={(value) => `${Math.round(value)}`}
              yCaption="milliseconds"
              emptyMessage="Collecting pings — one every four seconds while connected."
            />
          </div>

          <div className="chart-card">
            <div className="chart-card__head">
              <div>
                <div className="chart-card__title">Presence latency</div>
                <div className="chart-card__sub">
                  Rolling {WINDOW}-sample percentiles, milliseconds
                </div>
              </div>
              <ChartLegend series={latencySeries} />
            </div>
            <LineChart
              series={latencySeries}
              formatX={(value) => new Date(value).toLocaleTimeString()}
              formatY={(value) => `${Math.round(value)}`}
              yCaption="milliseconds"
              emptyMessage="Open this document in a second browser and move the cursor to collect samples."
            />
          </div>

          <div className="chart-card">
            <div className="chart-card__head">
              <div>
                <div className="chart-card__title">CRDT footprint vs document length</div>
                <div className="chart-card__sub">Encoded Y.Doc state, sampled every 2s</div>
              </div>
            </div>
            <LineChart
              series={footprintSeries}
              formatX={(value) => `${formatNumber(Math.round(value))} ch`}
              formatY={(value) => formatBytes(Math.round(value))}
              yCaption="bytes"
              emptyMessage="Type, or use Insert 10k characters, to plot growth."
            />
          </div>
        </div>

        <h2 className="section-title">Sync server</h2>
        {stats ? (
          <div className="tiles">
            <Tile label="Uptime" value={`${stats.uptimeSeconds}s`} />
            <Tile label="Open sockets" value={formatNumber(stats.connections)} />
            <Tile label="Documents in memory" value={formatNumber(stats.openDocuments)} />
            <Tile
              label="Persist writes"
              value={formatNumber(stats.writes)}
              hint={`${formatBytes(stats.bytesWritten)} written, ${stats.snapshots} snapshots`}
            />
          </div>
        ) : (
          <div className="notice">Sync server unreachable.</div>
        )}
      </div>
    </div>
  )
}

function TelemetryPageInner() {
  const searchParams = useSearchParams()
  const requested = searchParams.get('doc')
  const documentId = requested && isValidDocumentId(requested) ? requested : DEFAULT_DOC

  return (
    <AppShell documentId={documentId}>
      {({ session, snapshot }) => <TelemetryView session={session} snapshot={snapshot} />}
    </AppShell>
  )
}

export default function TelemetryPage() {
  return (
    <Suspense
      fallback={
        <main style={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
          <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Loading telemetry…</span>
        </main>
      }
    >
      <TelemetryPageInner />
    </Suspense>
  )
}
