import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

/**
 * Property test: whatever sequence of edits and partitions you throw at a set
 * of replicas, once every replica has seen every update they all hold the same
 * text. Hand-written cases prove the situations we thought of; this one is for
 * the ones we did not.
 *
 * The random source is a seeded PRNG so a failure is reproducible: the seed is
 * printed in the assertion message.
 */

function makeRandom(seed: number): () => number {
  // mulberry32
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']

interface Replica {
  doc: Y.Doc
  /** Updates produced locally that peers have not been handed yet. */
  outbox: Uint8Array[]
}

function createReplica(): Replica {
  const replica: Replica = { doc: new Y.Doc({ gc: true }), outbox: [] }
  replica.doc.on('update', (update: Uint8Array, origin: unknown) => {
    // Only local edits go in the outbox; relayed updates must not be re-sent
    // under this replica's name, or the simulation stops modelling a network.
    if (origin === 'remote') return
    replica.outbox.push(update)
  })
  return replica
}

function broadcast(replicas: Replica[], from: number): void {
  const pending = replicas[from].outbox
  replicas[from].outbox = []
  for (const update of pending) {
    replicas.forEach((replica, index) => {
      if (index === from) return
      Y.applyUpdate(replica.doc, update, 'remote')
    })
  }
}

function fullReconcile(replicas: Replica[]): void {
  // Flush every outbox, then exchange full state both ways so any replica that
  // missed an update while "offline" catches up.
  replicas.forEach((_, index) => broadcast(replicas, index))
  for (const a of replicas) {
    for (const b of replicas) {
      if (a === b) continue
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)), 'remote')
    }
  }
}

function runSimulation(seed: number, replicaCount: number, operations: number): string[] {
  const random = makeRandom(seed)
  const replicas = Array.from({ length: replicaCount }, createReplica)
  // Every replica starts from the same non-empty document.
  replicas[0].doc.getText('body').insert(0, 'shared opening line. ')
  fullReconcile(replicas)

  for (let step = 0; step < operations; step += 1) {
    const index = Math.floor(random() * replicaCount)
    const body = replicas[index].doc.getText('body')
    const length = body.length
    const roll = random()

    if (roll < 0.6 || length === 0) {
      const at = Math.floor(random() * (length + 1))
      body.insert(at, WORDS[Math.floor(random() * WORDS.length)] + ' ')
    } else if (roll < 0.85) {
      const at = Math.floor(random() * length)
      body.delete(at, Math.min(1 + Math.floor(random() * 6), length - at))
    } else {
      const at = Math.floor(random() * length)
      const count = Math.min(1 + Math.floor(random() * 4), length - at)
      body.format(at, count, { bold: true })
    }

    // A replica is "connected" on roughly two thirds of its turns. The rest of
    // the time its updates pile up, which is the partition.
    if (random() < 0.66) {
      broadcast(replicas, index)
    }
  }

  fullReconcile(replicas)
  return replicas.map((replica) => replica.doc.getText('body').toString())
}

describe('randomised convergence', () => {
  const seeds = [1, 7, 42, 1337, 90210, 2024, 55555, 8675309]

  it.each(seeds)('converges 3 replicas over 400 random operations (seed %i)', (seed) => {
    const results = runSimulation(seed, 3, 400)
    const [first] = results
    for (const result of results) {
      expect(result, `divergence with seed ${seed}`).toBe(first)
    }
    expect(first.length).toBeGreaterThan(0)
  })

  it('converges 5 replicas over 2000 random operations', () => {
    const results = runSimulation(20260917, 5, 2000)
    const [first] = results
    for (const result of results) {
      expect(result).toBe(first)
    }
  })

  it('never loses an insert that no replica deleted', () => {
    const replicas = [createReplica(), createReplica()]
    replicas[0].doc.getText('body').insert(0, 'start ')
    fullReconcile(replicas)

    const markers: string[] = []
    for (let step = 0; step < 50; step += 1) {
      const marker = `<${step}>`
      markers.push(marker)
      const target = replicas[step % 2]
      target.doc.getText('body').insert(target.doc.getText('body').length, marker)
      // Never broadcast: the whole run happens under a full partition.
    }

    fullReconcile(replicas)

    const merged = replicas[0].doc.getText('body').toString()
    expect(replicas[1].doc.getText('body').toString()).toBe(merged)
    for (const marker of markers) {
      expect(merged).toContain(marker)
    }
  })
})
