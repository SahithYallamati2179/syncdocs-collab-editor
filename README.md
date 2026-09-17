# SyncDocs

A real-time collaborative rich-text editor built on Yjs CRDTs — Google Docs-style
simultaneous editing with live cursors, threaded comments, version history, offline
support and full recovery after a network partition.

**Google sign-in is optional but built in.** Out of the box the app runs with no
accounts at all. Configure a Supabase project and it enforces per-document access
control: the creator owns a document, and only people they invite by email can open
it — unless the owner opens the link up, in which case it works with no sign-in at all.

It ships with a **telemetry view** that measures the things this kind of system is
actually judged on: convergence time after a partition, round-trip and presence
latency, and how the CRDT's memory footprint grows over a long document lifetime.

Documents go **in and out**: upload a Word `.docx`, Markdown, HTML or plain-text file
straight into a live document, and export or print what you have as Markdown, a
standalone HTML page, plain text, or the exact ProseMirror tree.

Sharing works two ways. Invite people by Google address, or open the link itself to
**anyone with it — view-only or editable, with no sign-in required**. View-only is
enforced on the connection, not in the toolbar.

**No dead UI.** Every control in the interface is wired to real behaviour — the
simulation chips close the actual WebSocket, version history reads real snapshots off
the server, and comments are stored inside the CRDT itself.

---

## Live demo

| | |
| --- | --- |
| **App** | https://syncdocs-collab-editor-web.vercel.app |
| **Sync server** | https://syncdocs-sync.onrender.com/health |

Open the app, sign in with Google, and **open the same document URL in a second
browser** to see the live cursors, presence and merge behaviour. To try it without an
account, the owner sets the Share dialog's access level to *Anyone with the link* —
link access needs no sign-in at all.

> **The sync server sleeps after ~15 minutes idle.** The first request after a quiet
> period takes 30–50 seconds to wake it, during which the editor shows *Offline* and
> queues edits locally. That is the app behaving correctly under a free-tier
> constraint, and it resolves itself — but load `/health` first if you want the
> editor to connect immediately.

---

## Table of contents

- [Quick start](#quick-start)
- [What is verified](#what-is-verified)
- [Architecture](#architecture)
- [The interface](#the-interface)
- [Project layout](#project-layout)
- [Commands](#commands)
- [Configuration](#configuration)
- [How to demo each requirement](#how-to-demo-each-requirement)
- [Telemetry](#telemetry)
- [Tests](#tests)
- [Design decisions](#design-decisions)
- [Known limitations](#known-limitations)
- [Deployment](#deployment)
- [Sharing, export and upload](#sharing-export-and-upload)
- [Google sign-in and document access](#google-sign-in-and-document-access)
- [Postgres persistence](#postgres-persistence)

---

## Quick start

Requires **Node 20 or newer**. Nothing else — no database, no account, no API key.

```bash
npm install
```

```bash
npm run dev
```

That starts both processes together:

| Service | URL | What it is |
| --- | --- | --- |
| Web app | http://localhost:3000 | Next.js editor UI |
| Sync server | ws://127.0.0.1:1234 | Hocuspocus WebSocket relay + HTTP endpoints |

Open http://localhost:3000 and it drops you into a document. Copy the URL into a second
browser to collaborate.

> **Testing with two users:** identity is stored per browser profile, so two tabs of
> the same browser appear as the *same* person (sync still works, but both avatars show
> one name). For a true two-user demo, use one normal window and one private window, or
> two different browsers.

First page load in dev takes 30–60s while Next compiles the route. Subsequent loads are
instant. Run `npm run build` first if you want production speed.

---

## What is verified

Everything below was confirmed by driving the running app, not by inspection:

| Check | Result |
| --- | --- |
| Test suite | **119 passing** across 7 files (`npm test`) |
| TypeScript, both workspaces | clean (`npm run typecheck`) |
| Production build | clean (`npm run build`) |
| Two clients editing one document | bidirectional text sync confirmed |
| Live remote cursors + presence avatars | rendering with correct per-user colour |
| Remote **selection highlighting** | two clients: a peer's selected range rendered on the other screen in that peer's colour, with their labelled caret |
| Comments written on client B | appeared on client A, with the unread badge |
| Simulated partition | 2 offline edits queued, merged on reconnect, **0 lost** |
| Convergence after a 7.3s partition | measured and logged in the activity feed |
| Version history restore | reverted the document, and `Ctrl+Z` undid the restore |
| Server round-trip ping | 2ms, p95 3ms |
| CRDT footprint at 10,026 characters | 11.3 KB encoded — **1.15 bytes per character** |
| Toolbar | every mark, block, list, alignment, table, image and link control exercised |
| `javascript:` URL, in the link dialog and in an imported file | rejected, text kept |
| Sign-in gate with auth enabled | non-document routes blocked until signed in |
| REST endpoints with auth enabled | 401 with no token and with a forged token |

Confirmed against the **deployed** stack rather than only locally:

| Check | Result |
| --- | --- |
| Postgres persistence | `/health` reports `driver: "postgres"`, and the database holds real document, ACL and snapshot rows |
| View-only link | guest connects, and the server **drops their edits** — verified by reading the stored `Y.Doc` back: the owner's text is there, the guest's is not |
| Edit link, signed out | guest connects with no account and their text persists |
| Restricted link, signed out | refused at the WebSocket handshake |
| Guest document list | empty, and the owner's address and invite list are redacted from a link visitor |
| Generated `.docx` | unzips to six valid OOXML parts with correct styles, numbering and relationships |
| Generated `.png` | a real 1640×522 image |
| Word-level diff on import | changed words marked inside their own formatting, and none of the highlight markup reaches the document |
| Delete a document | removed from the server, and the page moves off it rather than re-creating it |

---

## Architecture

```
Browser
 ├─ TipTap (ProseMirror) ──► Y.Doc ──┬──► y-indexeddb        offline + instant reload
 │                                   └──► HocuspocusProvider  binary updates + awareness
 ▼                                             │
Next.js (:3000)                                ▼
                                    Hocuspocus server (:1234)
                                      onAuthenticate  verify identity / JWT
                                      onLoadDocument  read persisted state
                                      onStoreDocument debounced write + snapshots
                                      onStateless     echo ping for round-trip timing
                                               │
                                        FileStore (default)
                                        PostgresStore (opt-in)
```

**The server is a relay and a persistence sink, not an authority.** It never resolves
conflicts — every client merges independently using Yjs's YATA algorithm, and they all
arrive at the same state regardless of the order updates are delivered in. That is what
makes partition tolerance fall out for free, and why a storage outage degrades
durability without breaking live collaboration.

**Everything collaborative lives in one Y.Doc.** The prose, the document title and the
comment threads are all fields of the same CRDT. They therefore share one merge story,
one offline story and one persistence path — a comment written during a partition
survives exactly as a keystroke does.

There are **three** independent layers of persistence:

1. **IndexedDB** — survives a page reload with no network at all.
2. **The in-memory Y.Doc + provider queue** — holds edits made while disconnected and
   flushes them on reconnect.
3. **Server storage** — survives a server restart and serves the first client to open
   the document.

---

## The interface

The UI follows a supplied Stitch design (light, indigo accent, three-pane workspace).
Dark mode is a derived variant — values re-stepped for the dark surface rather than
inverted — selectable in Settings.

| Region | Controls, and what each one really does |
| --- | --- |
| **Top bar** | Explorer toggle · document title (a live CRDT field — renaming syncs to every peer) · save-state chip (Saved / Saving / Local only) · command palette (`⌘K` / `Ctrl+K`) · connection status · presence stack with a popover of who is here · Export (download or print) · Share (copy link, choose the access level, invite and revoke by email) · collaboration-panel toggle with unread badge · avatar → Settings |
| **Explorer** | New Document · Upload a document · the documents actually persisted on the server, with real titles and sizes · documents this browser has open that the server has not stored yet · Upload · Export · Version History (reveals the activity panel) · Telemetry · Settings · workspace storage meter |
| **Toolbar** | undo/redo (collaboration-scoped) · block type · font family · font size · bold, italic, underline, strike, inline code · text colour · highlight · three alignments · bullet and numbered lists · link · table · image · live peer count |
| **Status strip** | connection state · measured WebSocket round trip · **Simulate: Sync / Lag / Offline**, which force a resync, inject 400 ms of egress delay, and close the socket for real |
| **Collaboration panel** | Comments tab — add (anchored to selected text), reply, resolve, reopen, delete, show/hide resolved · Activity tab — version history (preview and restore any snapshot, with who edited last) above the live event log of connects, partitions, syncs and convergence timings |
| **Telemetry** | load generators, stat tiles, three charts, server counters |

**Keyboard:** `⌘K` / `Ctrl+K` opens the command palette (arrows to move, Enter to run,
Escape to close). `⌘↵` / `Ctrl+↵` posts a comment or reply. Escape closes any dialog.

---

## Project layout

```
collab-editor/
├── apps/
│   ├── server/                  Yjs sync relay
│   │   ├── src/
│   │   │   ├── index.ts         Hocuspocus server + lifecycle hooks
│   │   │   ├── auth.ts          dev identity / Supabase JWT verification (JWKS + HS256)
│   │   │   ├── access.ts        ownership, invites, link levels, listing filter
│   │   │   ├── config.ts        env parsing with working defaults
│   │   │   ├── metrics.ts       server counters, served at /api/stats
│   │   │   ├── http-routes.ts   REST endpoints on the WebSocket port
│   │   │   └── storage/
│   │   │       ├── types.ts     DocStore contract + name validation
│   │   │       ├── file-store.ts      default: one .bin per document
│   │   │       └── postgres-store.ts  opt-in: Supabase/Neon/any Postgres
│   │   └── sql/schema.sql       run once for the Postgres driver
│   │
│   └── web/                     Next.js app
│       ├── app/
│       │   ├── page.tsx              reopens your last document
│       │   ├── doc/[id]/page.tsx     the editor
│       │   ├── telemetry/page.tsx    the measurements view
│       │   └── globals.css           design tokens, light + dark
│       ├── components/
│       │   ├── AppShell.tsx          three-pane frame, owns the session
│       │   ├── AuthGate.tsx          sign-in screen and session gate
│       │   ├── TopBar.tsx            title, presence, status, share
│       │   ├── Sidebar.tsx           document explorer
│       │   ├── RightPanel.tsx        comments + activity
│       │   ├── Editor.tsx            TipTap + Collaboration + cursors
│       │   ├── EditorToolbar.tsx     formatting controls
│       │   ├── StatusStrip.tsx       connection line + simulation chips
│       │   ├── CommandPalette.tsx    ⌘K
│       │   ├── VersionHistoryPanel.tsx  versions, inside the activity tab
│       │   ├── ShareDialog.tsx      people, access level, copy link
│       │   ├── ExportDialog.tsx     format picker, live preview, print
│       │   ├── ImportDialog.tsx     drag-drop upload, append or replace
│       │   ├── SettingsDialog.tsx · PromptDialog.tsx · Modal.tsx
│       │   └── LineChart.tsx         inline SVG chart with crosshair tooltip
│       └── lib/
│           ├── auth.ts          Supabase session, Google sign-in, access token
│           ├── supabase.ts      client + the authEnabled switch
│           ├── collab.ts        session manager: Y.Doc + providers, refcounted
│           ├── comments.ts      comment threads stored in the Y.Doc
│           ├── documents.ts     document list, title field, snapshots, access
│           ├── export.ts       Markdown/HTML/text/JSON serialisers, print
│           ├── import.ts       .docx/.md/.html/.txt/.json readers, sanitiser
│           ├── metrics.ts       client instrumentation store
│           ├── identity.ts · colors.ts · theme.ts · icons.tsx · font-size.ts
│           └── hooks.ts         React bindings
│
└── tests/
    ├── convergence.test.ts      hand-written partition + footprint cases
    ├── fuzz.test.ts             seeded randomised convergence property test
    ├── access.test.ts           ownership, invites, revocation, link levels
    ├── http-access.test.ts      the REST surface, over real HTTP
    └── markdown.test.ts         the hand-rolled Markdown converter
```

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start sync server and web app together |
| `npm run dev:server` | Sync server only |
| `npm run dev:web` | Web app only |
| `npm test` | Run the CRDT convergence and fuzz suites |
| `npm run test:watch` | Same, in watch mode |
| `npm run typecheck` | TypeScript across both workspaces |
| `npm run build` | Production build of both |
| `npm start` | Run both from the production build |

---

## Configuration

Every value has a working default; `.env` is optional. Copy `.env.example` if you want
to change something.

**Sync server** (`apps/server/.env`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `1234` | WebSocket + HTTP port |
| `AUTH_MODE` | `dev` | `dev` trusts the client identity; `supabase` verifies a JWT |
| `SUPABASE_JWT_SECRET` | — | Required when `AUTH_MODE=supabase` |
| `STORAGE_DRIVER` | `file` | `file` or `postgres` |
| `DATA_DIR` | `./.data` | Where the file driver writes |
| `DATABASE_URL` | — | Required when `STORAGE_DRIVER=postgres` |
| `PERSIST_DEBOUNCE_MS` | `2000` | Quiet period after the last edit before writing |
| `PERSIST_MAX_DEBOUNCE_MS` | `10000` | Hard ceiling while someone types continuously |
| `SNAPSHOT_INTERVAL_MS` | `300000` | How often a history snapshot is written |
| `CORS_ORIGIN` | `*` | Origin allowed to call the REST endpoints |

> Lower `SNAPSHOT_INTERVAL_MS` (say to `20000`) if you want Version History to fill up
> quickly during a demo.

**Web app** (`apps/web/.env.local`):

| Variable | Default |
| --- | --- |
| `NEXT_PUBLIC_COLLAB_WS_URL` | `ws://127.0.0.1:1234` |
| `NEXT_PUBLIC_COLLAB_HTTP_URL` | `http://127.0.0.1:1234` |

**Server endpoints:**

- `GET /health` — status, active storage driver, auth mode
- `GET /api/documents` — persisted documents with titles, filtered to what you may open
- `GET /api/stats` — connection, write and snapshot counters
- `GET /api/documents/:name/snapshots` — version history for a document
- `GET /api/documents/:name/snapshots/:id` — one snapshot, base64-encoded
- `GET|POST|DELETE /api/documents/:name/access` — read the ACL, invite, revoke

All of these require a bearer token when `AUTH_MODE=supabase`.

---

## How to demo each requirement

**Conflict resolution (CRDT, not last-write-wins)**

Open the same document in two browsers, put both cursors on the *same* word, and type at
once. Both sets of characters survive and both screens show identical text. Then run
`npm test` — the suite proves convergence for concurrent inserts at the same position,
three-way partitions healed in arbitrary order, deletes racing inserts, and 2000 random
operations across 5 replicas.

**Live presence: cursors *and* selection highlighting**

The avatar stack shows everyone in the document, with an online / away / offline dot;
click it for the full list. Remote carets appear inline with a coloured name label, and
when someone selects a range, **that range is highlighted on every other screen in that
person's colour**.

Verified with two real clients rather than assumed. With Alice selecting
`editing this sentence`, Bob's DOM contains:

```html
<span class="ProseMirror-yjs-selection"
      style="background-color: rgba(0, 131, 0, 0.44);">editing this sentence</span>
```

alongside her caret, labelled `Alice Anderson` in the same green. Selection state travels
over the Yjs **awareness** channel, not the document — it is ephemeral, never persisted,
and disappears on its own when a peer disconnects.

Colours are derived from a hash of the stable user id, so your colour does not change
when someone else leaves.

**Persistence and recovery**

- *Reload:* refresh mid-edit — content is restored from IndexedDB before the socket even
  connects.
- *Server restart:* stop the sync server (Ctrl+C) and start it again. Reopen the
  document — it loads from disk.
- *Mid-session disconnect:* see below.

**Offline editing and reconnection**

Click **Offline** in the status strip, keep typing — the strip counts the queued edits
and the save chip reads "Local only" — then click **Reconnect**. The Activity tab logs
how long convergence took and how many edits merged. Nothing is lost.

---

## Telemetry

`/telemetry` is the part that answers the evaluation criteria with numbers.

**Load generators** — *Insert 10k characters* and *Churn 5k (type then delete)*. Both
write straight into the shared Y.Doc, so an editor open in another tab sees them arrive
exactly as a remote peer's edits would. Churn is the interesting one: the character count
returns to where it started while the encoded state does not, and the difference is
tombstones — the long-document memory question made visible.

**Stat tiles** — encoded state size, character count, Yjs struct count (live items plus
tombstones), server round trip, presence p50, last convergence time.

**Charts** — server round trip over time, rolling presence-latency percentiles, and
encoded CRDT size plotted against document length.

**Sync server panel** — live counters read from `/api/stats`.

> **On the latency numbers:** the *round trip* is a true RTT — the client stamps its own
> clock into a stateless message, the server echoes it back, and the client subtracts. No
> clock skew, no second user needed. *Presence latency* is different: it is one-way,
> measured against the **sender's** clock, so across two machines it carries their skew
> and impossible values are discarded rather than plotted. Browsers also throttle timers
> in background tabs, so keep both windows visible or the numbers will look far worse
> than reality.

---

## Tests

```bash
npm test
```

**119 tests across seven files.** The convergence and fuzz suites run entirely in-process
on plain `Y.Doc`s — no browser, no WebSocket, no server. The network is simulated by
choosing when to hand updates between documents, so a partition is exact and
reproducible rather than a matter of timing.

**`tests/convergence.test.ts`** — concurrent inserts at the same position; three replicas
healed in an awkward order (twice, to prove order-independence); a delete racing an
insert into the deleted range; idempotent replay; a 500-edit offline backlog; delta vs
full-state sync equivalence; convergence on the `Y.XmlFragment` the editor actually uses;
and two footprint tests covering garbage collection and per-character overhead.

**`tests/fuzz.test.ts`** — a seeded property test. Random inserts, deletes and formatting
across 3–5 replicas with a randomised partition schedule; once every replica has seen
every update, they must all hold identical text. The PRNG is seeded so any failure is
reproducible, and the seed is printed in the assertion message. Includes a run where 50
edits are made under a *full* partition and every one must survive.

**`tests/access.test.ts`** — ownership claimed on first open, invites and revocation,
the owner-only checks, the listing filter, and the link levels: view mapping to a
`viewer` role, an invited editor keeping edit rights while the link is view-only,
unknown levels rejected rather than stored, and an ACL written before link sharing
existed reading back as `restricted` instead of undefined.

**`tests/http-access.test.ts`** — the REST endpoints driven over real HTTP with signed
tokens, which is where the Share dialog bug actually lived: calling the access module
directly could never have caught `GET /access` returning 403 on a document nobody had
claimed yet, because the module was not the broken part. Covers 401 vs 403, the
400/403 split on bad input, CORS preflight, and the full link-level round trip.

**`tests/markdown.test.ts`** — the hand-written converter, aimed at the cases that
make converters like it embarrassing: `**` inside a code span staying literal, nested
lists not flattening, parenthesised URLs surviving intact, and `javascript:` hrefs
losing their target while keeping their text.

**`tests/diff.test.ts`** — the import review. The property that matters is not that
the diff looks plausible but that the decisions reconstruct exactly what was chosen:
rejecting everything must return the original document, accepting everything the
incoming one. Both are asserted over 300 seeded random document pairs, along with the
rule that an arbitrary mixture never loses a line or invents one. The word-level cases
pin down which side is marked for a substitution, an insertion and a deletion, and that
every returned index is addressable — an off-by-one there does not look wrong, it
highlights the wrong word.

**`tests/database-url.test.ts`** — the startup checks on `DATABASE_URL`. Each case is a
mistake that is easy to make and expensive to diagnose, because none of them fail in a
way that names the real cause: the `[YOUR-PASSWORD]` placeholder left in, the IPv6-only
direct host that hangs instead of refusing, a missing password, a wrong protocol.

---

## Design decisions

**Yjs over Automerge or Loro.** Most mature ecosystem, smallest wire format, and real
garbage collection for tombstones. The `y-prosemirror` binding is the reason rich-text
collaboration works at all here — mapping a document tree to a CRDT is the hard part, and
it is a solved problem in this stack.

**Hocuspocus over raw `y-websocket`.** `y-websocket` has no authentication and no
persistence story. Hocuspocus provides `onAuthenticate`, `onLoadDocument`,
`onStoreDocument` and `onStateless` hooks, which is exactly the seam this app needs.

**Comments live in the Y.Doc, not in a REST table.** They inherit every property the
document already has: they merge under concurrency, they survive a partition, they are in
IndexedDB before they are anywhere else, and the existing persistence pipeline stores
them with no new table, endpoint or sync path. A separate comment store would have needed
its own conflict story.

**"Restore" applies a compensating edit; it does not rewind history.** You cannot
un-happen operations in a CRDT and still converge. Restoring reads the snapshot, converts
its fragment to a ProseMirror document and replaces the current content with it as a *new*
set of operations, which every peer merges normally. The snapshot itself is never mutated.

**Ownership is claimed on first open, not by a create endpoint.** The client picks a
document id and navigates to it; the server records whoever gets there first. Adding a
create endpoint would introduce a round trip and a failure mode for something that needs
neither, and it would not make ownership any better defined.

**Invites are stored as emails, not user ids.** A Supabase user id does not exist until
that person has signed in at least once, so an id-based invite could only ever reach
existing users. An email is what the owner actually knows.

**The access token is passed as a function, not a string.** The Hocuspocus provider
re-invokes it on every reconnect, so a token that expired during a long partition is
refreshed rather than replayed stale — which is exactly the case this app creates
deliberately with its partition simulator.

**No Redis.** A pub/sub fan-out layer only matters once you run multiple WebSocket
instances. One process holding one Y.Doc per document is the correct starting
architecture, and adding Redis before it is needed buys an ops dependency and nothing
else. The horizontal-scale path is Cloudflare Durable Objects — one Durable Object per
document gives single-threaded authority per document without a coordination layer.

**Merged state is persisted, not an append-only update log.** An update log grows without
bound and turns document load into an O(history) merge — exactly the memory-footprint
failure this project is meant to avoid. Yjs merges a full state update as cheaply as a
delta, so the merged form is strictly better for the primary row. History lives in a
separate snapshot table written on a slow interval, which can be pruned independently.

**The document title is denormalised on write.** It is authored inside the Y.Doc so it
merges like any other edit, and copied into storage on each persist so the explorer can
list documents without decoding every stored state.

**Writes are debounced, never per keystroke.** `PERSIST_DEBOUNCE_MS` is the quiet period;
`PERSIST_MAX_DEBOUNCE_MS` guarantees a durable write even while someone types
continuously.

**No initial document content.** Seeding a new document with starter text is the classic
way to get duplicated content: every client that opens the empty document inserts its own
copy before sync completes. A placeholder gives the same affordance with none of the risk.

**Undo comes from the Collaboration extension, not ProseMirror history.** StarterKit's
`history` is explicitly disabled. In a shared document, undo must be scoped to *your*
changes — otherwise Ctrl+Z reverts a collaborator's work.

**Sessions are refcounted in a module-level cache, not tied to component lifecycle.**
React StrictMode mounts effects twice in development, and a naive create-in-`useEffect`
opens two sockets and two IndexedDB connections per document. Refcounting with a short
grace period survives that, and survives route changes that revisit the same document.

**The partition is simulated at the socket, not the provider.**
`HocuspocusProvider.disconnect()` only detaches the provider from a shared socket — the
connection stays open. The app constructs its `HocuspocusProviderWebsocket` explicitly so
a simulated partition is a real one.

**Yjs is deduplicated in the bundle.** Two copies of Yjs in one bundle is a subtle killer:
types from one copy fail `instanceof` checks in the other and updates silently stop
applying. `next.config.mjs` aliases `yjs` to a single resolved module.

**Document names are validated, not sanitised.** Names arrive from untrusted clients and
become storage keys, which the file driver turns into paths. Anything outside
`[A-Za-z0-9_-]{1,64}` is rejected — silently rewriting a name would merge two unrelated
documents into one. Snapshot ids get the same treatment.

**Link protocols are allow-listed.** A document is shared by link, so a pasted
`javascript:` URL would be stored XSS aimed at every collaborator. Only `http`, `https`
and `mailto` are accepted.

**Presence colours are a colour-vision-deficiency validated categorical set**, assigned by
hashing the user id rather than by join order. The chart palette is validated against both
the light and dark chart surfaces.

---

## Known limitations

Stated plainly, because a limitation you find yourself is worse than one you were told
about.

- **`AUTH_MODE=dev` is not authentication.** It trusts the identity the browser sends,
  so the project runs with no external service. In that mode a document link is the
  only credential. Set `AUTH_MODE=supabase` for real access control.
- **A guest's display name is not verified.** Anonymous link visitors pick their own
  cursor label. It is decoration; the server treats them as having no identity at all,
  and they can never own a document or change who has access.
- **Invites are by email, so changing your Google address loses access** until the owner
  re-invites the new one.
- **A comment whose anchor text is deleted becomes orphaned.** The thread survives with
  the quoted text it was written against, but "jump to this text" has nowhere to go and
  says so. Deleting the sentence a comment is about is a legitimate edit, not an error
  to prevent.
- **Version history is snapshot-based, not per-edit.** The server writes at most one
  snapshot per `SNAPSHOT_INTERVAL_MS` (5 minutes by default), so history is a coarse
  timeline rather than a full operation log. It also names only the *last* editor before
  each snapshot, which is an honest label rather than an audit trail.
- **Snapshots are never pruned automatically.** A retention query is included as a
  comment in `sql/schema.sql`.
- **Images are referenced by URL, not uploaded.** There is no blob store. This is why
  `.docx` export writes images as a labelled placeholder carrying the URL, and why PNG
  export cannot include them.
- **PNG/JPG export cannot fetch remote resources.** It renders through an SVG
  `foreignObject`, which is not allowed to load external images or web fonts. Text,
  layout, colour, tables and lists are faithful; pictures are not. PDF via the print
  dialog is the answer when fidelity matters, and the dialog says so.
- **The import diff is block-level with word-level highlighting inside changed lines.**
  It pairs the nth removal with the nth addition in a run, which is right for edits in
  place and approximate when a file reorders paragraphs wholesale.
- **Lag injection is egress-only.** It delays what this client sends; the server still
  answers at full speed. A measured round trip therefore moves by roughly the configured
  amount rather than twice it.
- **Single sync-server process.** Correct for one instance; horizontal scale needs the
  Durable Objects path described above.
- **Free-tier hosting sleeps after ~15 minutes idle**, so the first visit after a quiet
  period waits 30–50 seconds for the sync server to wake.
- **AI Copilot from the reference design is deliberately absent** rather than present and
  dead — it needs a language model behind it, which is a separate piece of work.

---

## Deployment

This app is **two deployables, not one**, and that is forced by the architecture:

| Piece | Needs | Goes on |
| --- | --- | --- |
| Next.js web app | static + serverless rendering | Vercel |
| Hocuspocus sync server | a long-lived process holding WebSockets | Render (Docker) |

Serverless functions cannot hold a WebSocket open, so the sync server cannot live on
Vercel. `apps/server/Dockerfile` and `render.yaml` are in the repo for exactly this.

### Two things that will bite you on a free tier

**Use Postgres, not the file driver — and treat that as required, not optional, once
`AUTH_MODE=supabase` is on.** Free hosts give you an ephemeral filesystem (Render states
plainly that "Disks are not supported for free compute plans"), so `STORAGE_DRIVER=file`
loses everything under `DATA_DIR` on each redeploy and each idle spin-down. That means
not just documents but **the access-control records too** — ownership and every
invitation you have issued. The visible symptom is that you invite a collaborator, the
service sleeps, and afterwards the document has no owner and your invite list is empty.
Point `DATABASE_URL` at Postgres and run `apps/server/sql/schema.sql` once.

**Free services sleep after ~15 minutes idle.** The first visit after a quiet period
takes 30–50 seconds to wake the sync server, during which the editor shows "Offline"
and edits queue locally. That is the app behaving correctly, but warn anyone you send
a cold link to.

### Order of operations

The pieces depend on each other's URLs, so deploy in this order.

**1. Postgres** — create a project (Supabase or Neon) and run
`apps/server/sql/schema.sql` against it. In Supabase that is SQL Editor → paste → Run.

Then copy the **pooled** connection string from the dashboard's *Connect* button. Take
the **Session pooler** one (host `…pooler.supabase.com`, port `5432`), not the direct
connection. Two reasons, and both bite:

- The direct host (`db.<ref>.supabase.co`) resolves to **IPv6 only** on the free tier,
  and free Render instances have no IPv6 route to it. The connection does not fail
  fast — it hangs and then times out, which looks like a slow database rather than an
  unreachable one.
- Session mode suits a long-lived server holding a connection pool. Transaction mode
  (port `6543`) also works here and is the right pick for serverless, but there is no
  reason to take its prepared-statement caveats for a process that never exits.

The string contains your database password, so treat it like one: paste it straight
into the host's environment settings and nowhere else.

**2. Sync server on Render** — New → Blueprint → pick this repository. `render.yaml` is
detected automatically. Then set, in the service's Environment tab:

```
STORAGE_DRIVER=postgres
DATABASE_URL=<your pooled Postgres connection string>
```

Wait for the deploy, then confirm it is alive:

```bash
curl https://<your-service>.onrender.com/health
```

**3. Web app on Vercel** — import the repository and set **Root Directory** to
`apps/web`. Vercel detects Next.js and the workspace lockfile at the repo root. Add:

```
NEXT_PUBLIC_COLLAB_WS_URL=wss://<your-service>.onrender.com
NEXT_PUBLIC_COLLAB_HTTP_URL=https://<your-service>.onrender.com
```

Note `wss://`, not `ws://` — a browser on an HTTPS page refuses an insecure WebSocket.

**4. Lock CORS back down** — return to Render and set:

```
CORS_ORIGIN=https://<your-app>.vercel.app
```

The default `*` is fine locally and too loose in public.

**5. If you enabled Google sign-in**, add the production URLs too: the Vercel origin in
the Google OAuth client's authorised origins, and
`https://<your-app>.vercel.app/auth/callback` in Supabase → Authentication → URL
Configuration → Redirect URLs.

### Building the server image locally

```bash
docker build -f apps/server/Dockerfile -t syncdocs-server .
```

```bash
docker run -p 1234:1234 -e STORAGE_DRIVER=file syncdocs-server
```

---

## Sharing, export and upload

### Access levels

The Share dialog offers three, and the choice is the owner's alone:

| Level | What the bare URL is worth |
| --- | --- |
| **Only invited people** (default) | Nothing. The opener must be the owner or an invited member. |
| **Anyone with the link can view** | Read-only, **no sign-in required**. |
| **Anyone with the link can edit** | Full editing, **no sign-in required**. |

Three things about this are deliberate:

**Membership beats the link level.** Someone you invited stays an editor even while the
link is view-only. The link raises the floor for strangers; it does not lower the
ceiling for your colleagues.

**View-only is enforced on the connection, not in the UI.** `onAuthenticate` sets
`connection.readOnly` for a viewer, so Hocuspocus drops their updates at the server.
Hiding the toolbar is the courtesy; that flag is the control. Someone who re-enables
the editor from the console gets a document that refuses to change for anybody.

**Link sharing does not add the document to a visitor's explorer.** You reach a
link-shared document by following its link; it joins your workspace only once the owner
invites you. Otherwise "shared with one colleague" silently becomes a workspace-wide
broadcast to every account on the deployment.

**A guest is genuinely anonymous.** A signed-out browser presents a guest sentinel
instead of an access token, gets a locally generated name and colour for its cursor,
and is treated by the server as having no identity at all. What that buys it is exactly
the link level and nothing more:

- A guest can never claim an unowned document. Claim-on-first-open is how documents come
  into existence, so it has to be attributable — otherwise anyone could mint and own
  documents on the deployment by guessing names.
- A guest never sees the owner's address or the invite list. A share link shares the
  document, not the guest list; returning the raw ACL would turn a view link into a way
  to harvest addresses.
- A guest gets an empty explorer, and cannot invite, revoke or change the link level.
- A token that is *present but invalid* is still an error. Only an absent token becomes a
  guest, so an expired session surfaces as "sign in again" rather than a silent,
  baffling loss of access.

A refusal aimed at a guest is `401`, not `403`: signing in genuinely might change the
answer, and `403` would tell the browser to stop asking.

### Export

Markdown, standalone HTML, plain text, and the ProseMirror JSON tree, plus
**Print / Save as PDF**. The Markdown serialiser is hand-written against the document
tree (headings, nested lists, tables, code fences, links, images, marks) rather than
pulled in as a dependency, and `tests/markdown.test.ts` covers it.

Printing renders into a hidden iframe rather than the live page, so the sidebar,
toolbar and collaboration panel do not end up in the PDF.

Every format is serialised from the **local replica**. An export therefore works
offline and mid-partition — "I can still get my words out" should not depend on the
service that just went down.

### Upload

| Format | How it is read |
| --- | --- |
| `.docx` | [mammoth](https://github.com/mwilliamson/mammoth.js), dynamically imported so it stays its own chunk |
| `.md`, `.markdown` | hand-written converter |
| `.html`, `.htm` | parsed and sanitised |
| `.txt` | paragraphs split on blank lines |
| `.json` | this app's own export, re-imported exactly with no HTML round trip |

Everything funnels through HTML, because that is what TipTap parses using the schema
the editor is actually configured with — anything the schema does not know is dropped
on the way in rather than producing an invalid document.

You choose **Add to the end** or **Replace everything**. Both are ordinary editor
commands, not direct Y.Doc surgery, so an import merges with whatever a collaborator is
typing at that moment, replicates to every peer, and undoes with `Ctrl+Z`. Replace is a
delete-then-insert for the same reason: swapping the document out would discard the
shared history and hand every peer a state they cannot merge.

An uploaded file is untrusted input that is then replicated to every collaborator, so
scripts, event handlers and unsafe `href`/`src` URLs are stripped before the content
reaches the editor. A `javascript:` link in a Markdown file keeps its text and loses
its target.

---

## Google sign-in and document access

Authentication is **off by default** so the project runs with no setup. Turning it on
requires a Google OAuth client and a Supabase project — both free. With it on:

- Nobody can open the app without signing in with Google.
- The first person to open a document id becomes its **owner**.
- The owner invites people by email in the Share dialog. Nobody else can open the
  document, even with the link.
- The document list only shows documents you own or were invited to.
- The sync server rejects the WebSocket *and* the REST endpoints for anyone else.

### 1. Create the Google OAuth client

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
**Create Credentials → OAuth client ID → Web application**:

| Field | Value |
| --- | --- |
| Authorised JavaScript origins | `http://localhost:3000` |
| Authorised redirect URIs | `https://<your-project-ref>.supabase.co/auth/v1/callback` |

The redirect URI points at **Supabase**, not at your app — Supabase is the party
completing the OAuth exchange. Copy the **Client ID** and **Client secret**.

### 2. Configure Supabase

In your [Supabase](https://supabase.com) project:

1. **Authentication → Providers → Google** — enable it, paste the client ID and secret.
2. **Authentication → URL Configuration → Redirect URLs** — add `http://localhost:3000/auth/callback`.
   This one entry is enough: the app always returns to that path and restores the
   document you were opening from session storage.
3. **Project Settings → API** — copy the **Project URL** and the **anon public** key.

### 3. Configure this app

`apps/web/.env.local`:

```
NEXT_PUBLIC_COLLAB_WS_URL=ws://127.0.0.1:1234
NEXT_PUBLIC_COLLAB_HTTP_URL=http://127.0.0.1:1234
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon public key>
```

`apps/server/.env`:

```
AUTH_MODE=supabase
SUPABASE_URL=https://<your-project-ref>.supabase.co
```

Restart with `npm run dev`. The server banner should read
`auth : supabase (Google sign-in required)`.

> If your Supabase project still signs tokens with the legacy shared secret rather than
> an asymmetric key, also set `SUPABASE_JWT_SECRET` (Project Settings → API → JWT
> Secret). The server picks the right key material per token by reading the `alg`
> header, so setting both is harmless.

### How it works

The browser signs in with Supabase, which returns a JWT. The provider passes that token
to the sync server **as a function, not a string** — the provider re-invokes it on every
reconnect, so a token that expired during a long partition is refreshed rather than
replayed stale. The server verifies the signature against Supabase's published JWKS (or
the shared secret for legacy projects) in `onAuthenticate`, then checks the document ACL
before allowing the socket to join.

The REST endpoints carry the same bearer token and run the same verification. Guarding
only the WebSocket would have moved the hole rather than closed it: `/api/documents`
leaks document names, and the access endpoints change permissions.

Access records live beside the document (`<name>.acl.json` for the file driver, the
`document_access` table for Postgres). Members are stored as lowercased **emails** rather
than user ids, because an email is the only identifier an owner knows about someone who
has never signed in — so invites work before the invitee's first login.

---

## Postgres persistence

Optional locally, **required for any real deployment** — see the free-tier note above.

1. Create a Postgres database (the Supabase free tier works).
2. Run `apps/server/sql/schema.sql` against it. It creates the document, snapshot and
   access tables, and is safe to re-run: every statement is `if not exists`, and the
   `link_access` column is added by a separate `alter … add column if not exists` so a
   database created before link sharing upgrades in place.
3. Set `STORAGE_DRIVER=postgres` and `DATABASE_URL=...` in `apps/server/.env`.

### What the server checks at startup

`STORAGE_DRIVER=postgres` is validated before the connection pool is built, and
the database is probed once the server is listening. Each check exists because
the corresponding mistake otherwise surfaces late and blames the wrong thing:

| Problem | What you would have seen instead |
| --- | --- |
| `DATABASE_URL` empty or malformed | A driver error with no mention of the variable |
| The `[YOUR-PASSWORD]` placeholder left in | `password authentication failed`, with no hint that the password is literally the placeholder |
| The direct `db.<ref>.supabase.co` host | A **hang**, then a timeout — reading as a slow database rather than an unreachable one |
| Schema never run | `relation "documents" does not exist`, on someone's first edit rather than at boot |
| Host unreachable | Nothing at all until the first persist, minutes later |

The malformed cases refuse to start, because there is nothing sensible to do
with them. An unreachable host or a missing schema is logged loudly and marks
`/health` as `degraded` but does **not** kill the process: live collaboration is
a pure relay and keeps working without storage, so exiting would turn a
durability problem into an outage.

The connection string is redacted before it reaches a log.

### A note on Supabase and RLS

Supabase publishes every table in the `public` schema through PostgREST, and the
publishable key ships inside the browser bundle. Left alone, that means anyone who
views source can read `documents` and `document_access` straight out of the REST API —
every document body and every ACL, bypassing the sync server entirely.

The schema therefore enables row-level security on all three tables and defines **no
policies at all**, which denies everything through PostgREST. The sync server is
unaffected: it connects over a direct Postgres connection as the owning role, and that
role bypasses RLS. Supabase's linter reports these as `rls_enabled_no_policy` at INFO
level; here that is the intended state, not a gap to close.
