import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

/**
 * These tests are the actual claim of this project: that concurrent edits made
 * on partitioned replicas converge, with no server arbitrating and no edit lost.
 *
 * They run entirely in-process on plain Y.Docs, with no browser, no WebSocket
 * and no server. That is deliberate: the network is simulated by choosing when
 * to hand updates between docs, so a partition here is exact and reproducible
 * rather than a matter of timing.
 */

/** One directional delivery: everything `target` has not seen yet from `source`. */
function deliver(source: Y.Doc, target: Y.Doc): void {
  const missing = Y.encodeStateAsUpdate(source, Y.encodeStateVector(target))
  Y.applyUpdate(target, missing)
}

/** Heal a partition between two replicas. */
function reconcile(a: Y.Doc, b: Y.Doc): void {
  deliver(a, b)
  deliver(b, a)
}

function text(doc: Y.Doc): string {
  return doc.getText('body').toString()
}

describe('convergence', () => {
  it('merges concurrent inserts at the same position without losing either', () => {
    const alice = new Y.Doc()
    const bob = new Y.Doc()

    alice.getText('body').insert(0, 'hello world')
    reconcile(alice, bob)
    expect(text(bob)).toBe('hello world')

    // Partition: both type at offset 5, neither can see the other.
    alice.getText('body').insert(5, ' there')
    bob.getText('body').insert(5, ' dear')

    reconcile(alice, bob)

    expect(text(alice)).toBe(text(bob))
    expect(text(alice)).toContain('there')
    expect(text(alice)).toContain('dear')
  })

  it('converges across three replicas healed in an arbitrary order', () => {
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
    docs[0].getText('body').insert(0, 'base. ')
    reconcile(docs[0], docs[1])
    reconcile(docs[0], docs[2])

    docs[0].getText('body').insert(6, 'A')
    docs[1].getText('body').insert(6, 'B')
    docs[2].getText('body').insert(6, 'C')

    // Heal in a deliberately awkward order, twice, to prove order-independence.
    reconcile(docs[1], docs[2])
    reconcile(docs[0], docs[2])
    reconcile(docs[0], docs[1])
    reconcile(docs[1], docs[2])

    expect(text(docs[0])).toBe(text(docs[1]))
    expect(text(docs[1])).toBe(text(docs[2]))
    for (const letter of ['A', 'B', 'C']) {
      expect(text(docs[0])).toContain(letter)
    }
  })

  it('resolves a delete concurrent with an insert into the deleted range', () => {
    const alice = new Y.Doc()
    const bob = new Y.Doc()
    alice.getText('body').insert(0, 'the quick brown fox')
    reconcile(alice, bob)

    alice.getText('body').delete(4, 5) // removes "quick"
    bob.getText('body').insert(7, 'EST') // types inside "quick"

    reconcile(alice, bob)

    expect(text(alice)).toBe(text(bob))
    // The deletion wins over the characters it covered; the new characters,
    // which no replica deleted, survive. Nothing is silently dropped.
    expect(text(alice)).toContain('EST')
    expect(text(alice)).not.toContain('quick')
  })

  it('is idempotent: replaying the same update changes nothing', () => {
    const alice = new Y.Doc()
    const bob = new Y.Doc()
    alice.getText('body').insert(0, 'exactly once')

    const update = Y.encodeStateAsUpdate(alice)
    Y.applyUpdate(bob, update)
    Y.applyUpdate(bob, update)
    Y.applyUpdate(bob, update)

    expect(text(bob)).toBe('exactly once')
  })

  it('merges a long offline backlog on reconnect', () => {
    const online = new Y.Doc()
    const offline = new Y.Doc()
    online.getText('body').insert(0, 'shared start. ')
    reconcile(online, offline)

    // The offline replica works for a while with no connectivity at all.
    for (let index = 0; index < 500; index += 1) {
      offline.getText('body').insert(offline.getText('body').length, `o${index} `)
    }
    // Meanwhile the online replica keeps moving too.
    for (let index = 0; index < 500; index += 1) {
      online.getText('body').insert(0, `n${index} `)
    }

    reconcile(online, offline)

    expect(text(online)).toBe(text(offline))
    expect(text(online)).toContain('o499')
    expect(text(online)).toContain('n499')
  })

  it('reaches the same state whether the whole doc or a delta is shipped', () => {
    const source = new Y.Doc()
    source.getText('body').insert(0, 'delta encoding check')
    // Capture the state the client already had before the second edit landed.
    const alreadySeen = Y.encodeStateAsUpdate(source)
    source.getText('body').insert(5, ' XYZ ')

    const viaFullState = new Y.Doc()
    Y.applyUpdate(viaFullState, Y.encodeStateAsUpdate(source))

    // A client that holds the earlier state and asks only for what it is
    // missing -- which is exactly what the sync protocol does on reconnect.
    const viaDelta = new Y.Doc()
    Y.applyUpdate(viaDelta, alreadySeen)
    Y.applyUpdate(viaDelta, Y.encodeStateAsUpdate(source, Y.encodeStateVector(viaDelta)))

    expect(text(viaFullState)).toBe(text(source))
    expect(text(viaDelta)).toBe(text(source))
  })

  it('converges on the XmlFragment the rich-text editor actually uses', () => {
    const alice = new Y.Doc()
    const bob = new Y.Doc()

    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText('first paragraph')])
    alice.getXmlFragment('default').insert(0, [paragraph])
    reconcile(alice, bob)

    const aliceBlock = new Y.XmlElement('heading')
    aliceBlock.insert(0, [new Y.XmlText('Alice heading')])
    alice.getXmlFragment('default').insert(1, [aliceBlock])

    const bobBlock = new Y.XmlElement('paragraph')
    bobBlock.insert(0, [new Y.XmlText('Bob paragraph')])
    bob.getXmlFragment('default').insert(1, [bobBlock])

    reconcile(alice, bob)

    const aliceXml = alice.getXmlFragment('default').toString()
    expect(aliceXml).toBe(bob.getXmlFragment('default').toString())
    expect(aliceXml).toContain('Alice heading')
    expect(aliceXml).toContain('Bob paragraph')
  })
})

describe('footprint', () => {
  it('reclaims space for deleted content once garbage collection runs', () => {
    const withGc = new Y.Doc({ gc: true })
    const withoutGc = new Y.Doc({ gc: false })

    for (const doc of [withGc, withoutGc]) {
      const body = doc.getText('body')
      for (let round = 0; round < 200; round += 1) {
        body.insert(body.length, 'some text that will be removed again ')
        body.delete(0, body.length)
      }
    }

    const gcBytes = Y.encodeStateAsUpdate(withGc).byteLength
    const noGcBytes = Y.encodeStateAsUpdate(withoutGc).byteLength

    // Both documents are empty. The one that keeps full tombstones is
    // materially larger, which is why the app enables gc.
    expect(withGc.getText('body').length).toBe(0)
    expect(gcBytes).toBeLessThan(noGcBytes)
  })

  it('keeps encoded size roughly proportional to surviving content', () => {
    const doc = new Y.Doc({ gc: true })
    const body = doc.getText('body')
    const line = 'a reasonably typical sentence of prose. '

    body.insert(0, line.repeat(250)) // ~10k characters
    const bytesPerChar = Y.encodeStateAsUpdate(doc).byteLength / body.length

    // Sequential typing compresses well; this guards against a regression that
    // makes per-character overhead explode.
    expect(bytesPerChar).toBeLessThan(4)
  })
})
