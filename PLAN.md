# Nukkad — Build Plan

> **"Meet me at Nukkad."** A multiplayer 3D copy of any real neighbourhood, built from open map
> data, that you and your friends walk and ride around in from a phone browser.

| | |
|---|---|
| Status | **APPROVED 2026-11-10** ("OK, use your picks"). Answers to the five questions are in NOTES.md. |
| Day 1 | 2026-11-10 (Tue) |
| Playable end to end by | end of Day 4 — 2026-11-13 (Fri) |
| Days 5–6 | debugging, real-phone testing and launch only |
| Roles | Product owner: you · Lead engineer: Claude |

Words in *italics* the first time they appear are explained in the [glossary](#14-glossary).

---

## 0. The whole plan on one screen

1. **One repo, three parts:** a web client (Vite + TypeScript + Three.js + Rapier), a small Node
   server (Express + WebSocket + MongoDB), and shared code both use (message formats, map → mesh maths).
2. **The server fetches the map, not the phone.** It asks OpenStreetMap once per place, turns the
   answer into one small file we call an *Area Pack*, and caches it. Every friend downloads the
   same pack, so everyone sees the exact same world.
3. **The phone builds the 3D world in a web worker**, chunk by chunk, so the screen never freezes.
4. **You move yourself; the server referees the room.** Your phone simulates your own avatar and
   sends its position 15 times a second. The server checks it, and sends everyone a snapshot 15
   times a second. Other players are drawn about 130 ms in the past so their movement looks smooth.
5. **Voice is browser-to-browser** (WebRTC), push-to-talk, never recorded, never touches our database.
6. **Everything you see is made by our own code** (buildings, avatars, scooter, textures, sounds).
   No downloaded models, no photos, no brands. That keeps it fast and legally clean.
7. **Three quality levels** (Low / Medium / High) picked automatically by a quick benchmark.
   Medium is tuned for a mid-range Android phone at 30 fps.
8. **Honest warnings** (details in [§10](#10-risk-list)): the public OpenStreetMap server is slow
   (18–34 s when I measured it today), voice on mobile data needs a relay server we must set up,
   and Day 4 is the fullest day. The cut order you gave decides what drops if time runs out.

---

## 1. Ground rules (so any new session can continue without re-explaining)

**How we work**
1. Plan first, then your OK, then code.
2. `NOTES.md` (decisions, status, known bugs, next steps) and `BUGS.md` (repro steps, status) are updated at the end of every phase.
3. After each phase: run it, test it, report in **5 lines or fewer** what to look at and how to test on your phone over local Wi-Fi. **Stop for feedback only after Phases 1, 3 and 5.**
4. Be honest. If something doesn't work yet, say so. Never fake a feature or silently skip a requirement.
5. Git commit after every phase with a clear message.
6. If requirements conflict, stop and ask.

**Priority order — cut from the bottom if time runs short**

| # | Feature | # | Feature |
|---|---|---|---|
| 1 | map → 3D world | 7 | photo mode |
| 2 | walking | 8 | scooter |
| 3 | multiplayer with 4+ players | 9 | weather |
| 4 | invite rooms | 10 | emotes |
| 5 | day-night + lighting | 11 | procedural facade variety |
| 6 | voice | | |

Anything below the cut line gets a **stub + a TODO in NOTES.md**, never a half-working feature.

**Product rules:** runs in a mobile browser from a link · no download · no signup (pick a name and
join) · friends-only by invite link · max 8 per room · store almost nothing · ~30 fps on a
mid-range Android · any real place on Earth, ~500 m around the chosen spot.

**Legal rules:** open data only (OpenStreetMap, open elevation tiles) · no Google Maps, Street View
or scraped imagery · no real brand logos or shop signs · no ripped assets · everything listed in
`CREDITS.md` · OSM attribution in the UI and in saved photos · Nominatim used by its policy.

---

## 2. Reality check — what the real data looks like (measured today)

I ran one real query for the test square: **1.2 km × 1.2 km centred on Assetz East Point,
Bengaluru (12.92068, 77.69532)**.

| What | Number | What it means for us |
|---|---|---|
| Buildings | **1,744** | good coverage, the place will be recognisable |
| …with a real height | 3 | — |
| …with a floor count | 636 (36 %), median 2 floors, max 20 | **64 % of heights must be guessed** by our rules |
| Triangles for all buildings | ≈ 22,000 (≈ 13 each) | geometry is light; the danger is *draw calls* and pixels, not triangles |
| Roads | 300 ways, **42.5 km** (residential 24.7 km, footway 4.2, tertiary 4.1, service 3.6, secondary 2.6) | plenty of streets to walk |
| Bridges / tunnels | 0 / 1 | flyovers are not an issue here (they are elsewhere) |
| Parks, gardens, pitches, playgrounds | 4 / 3 / 15 / 7 | some green, plus 15 scrub patches, 1 lake, 12 pools |
| Trees mapped | **4** | almost all trees must be invented by us |
| Street lamps / benches mapped | **0 / 0** | all street lamps must be invented by us |
| Raw download | 1.46 MB JSON, **202 KB** zipped | small enough for mobile data |
| Time to fetch from the public server | **18 s** (and 34 s for a tiny count query) | the first visit to a new place is slow → cache + honest loading screen |

---

## 3. Architecture

```
                        PHONE / LAPTOP BROWSER   (apps/web)
┌──────────────────────────────────────────────────────────────────────────────┐
│ UI layer (React)   landing · place picker · avatar · HUD · settings · photo  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Game core (main thread)                                                      │
│   Renderer   Three.js / WebGL2: sky, terrain, chunks, avatars, effects       │
│   Physics    Rapier (WASM): your capsule or scooter vs terrain + buildings   │
│   Input      joystick + drag-to-look (touch) · WASD + mouse (desktop)        │
│   Streamer   decides which chunks to load, unload, and at what detail        │
│   Net        WebSocket client · snapshot buffer · interpolation · reconnect  │
│   Voice      WebRTC audio mesh · push-to-talk · who-is-speaking              │
├──────────────────────────────▲───────────────────────────────────────────────┤
│ World worker (Web Worker)    │ finished typed arrays, zero-copy              │
│   download Area Pack → index by chunk → build chunk meshes + collision       │
└───────┬──────────────────────────────┬──────────────────────────┬────────────┘
        │ HTTPS  /api/*                │ WSS  /ws                 │ WebRTC audio
        ▼                              ▼                          ▼
┌────────────────────────────────────────────────────────┐   other players' browsers
│ NUKKAD SERVER   (apps/server · Node.js, one process)    │   (direct, or through a
│   REST      /api/areas  /api/search  /api/rooms         │    TURN relay — see §6.6)
│             /api/ice    /api/health                     │
│   Realtime  rooms (max 8) · 15 Hz snapshots ·           │
│             voice signalling relay                      │
│   Guards    rate limits · message validation ·          │
│             origin check · size caps                    │
│   Areas     Overpass + elevation → Area Pack → cache    │
└───────┬───────────────────────────┬────────────────────┘
        ▼                           ▼
  MongoDB (Atlas)             Open data — fetched by the server only, then cached
  rooms · areas · geocache    Overpass (OSM) · Terrarium elevation tiles · Nominatim
```

### 3.1 Tech choices

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript 7, `strict` | your rule; catches bugs before the phone does |
| Client build | Vite 8 | fast dev server, built-in support for workers and WASM |
| 3D | Three.js r187 (WebGL2) | runs on every recent phone, most examples |
| Physics | Rapier 0.21 (`rapier3d-compat`) | ships a character controller (slopes, step-up, snap to ground) |
| UI | React 19 — menus and HUD only | you already know it; the 3D canvas stays plain Three.js (no react-three-fiber) |
| Server | Express 5 + `ws` 8 | small, plain, familiar |
| Database | MongoDB with Mongoose 9 | your MERN stack; TTL indexes delete old rooms automatically |
| Tests | Vitest 5 | one `npm test` runs everything |
| Map picker | Leaflet 1.9 + OSM tiles, loaded only on the picker screen | lets you drop a pin when search can't find a place |
| Small helpers | `earcut` (cuts polygons into triangles), `fast-png` (reads elevation tiles), `tz-lookup` (time zone of a place) | tiny, permissive licences |

Versions are today's latest on npm, pinned exactly in `package.json`. **Honest note:** TypeScript 7,
Vite 8 and Rapier 0.21 are newer than the versions I know best, so I read their release notes
before relying on them. If one causes trouble I pin the previous major version and write it in NOTES.md.

### 3.2 The three decisions everything else hangs on

**A. The server builds the map, not the phone.** From a browser we can't set our own identifying
User-Agent or keep the whole app under Nominatim's 1-request-per-second limit, and 8 friends
shouldn't each hammer a free public server. So the server fetches, converts and caches; the
phone's worker only downloads our small Area Pack. (This still respects
"never block the main thread": the download, parsing and mesh building all happen in the worker.)

**B. One immutable Area Pack per place.** If two phones built their worlds from slightly different
data, a friend could appear to walk through a wall. One cached pack = one shared truth. All
"random" choices (colours, tree positions, height guesses) come from a seed based on the map data,
so "meet me at the red building" works for everyone.

**C. You simulate yourself; the server referees.** Running physics for every player on the server
is far too big for 4 days. Instead each phone moves its own avatar and the server sanity-checks
it (inside the map? not faster than a scooter?). For a hangout with no scores to cheat at, this is
the standard, sensible choice. The server stays fully in charge of **who is in the room**.

---

## 4. Folder structure

```
nukkad/                              (npm workspaces; your local folder stays 28_Nukkad)
├─ PLAN.md  NOTES.md  BUGS.md  TESTING.md  CREDITS.md  README.md
├─ CLAUDE.md                         tells any new Claude session: read PLAN → NOTES → BUGS first
├─ .env.example  .gitignore  package.json  tsconfig.base.json
├─ apps/
│  ├─ web/                           the game — deploys to Vercel
│  │  ├─ index.html                  the game page
│  │  ├─ debug.html                  Phase 1 world viewer: free-fly camera + counters
│  │  └─ src/
│  │     ├─ ui/                      React screens and HUD
│  │     ├─ game/                    main loop, scene setup, quality tiers, benchmark
│  │     ├─ world/                   streamer, chunk meshes, terrain, materials, atlas, LOD
│  │     ├─ workers/                 world.worker.ts + its typed message contract
│  │     ├─ physics/                 Rapier setup, colliders, walking + scooter controllers
│  │     ├─ player/                  avatar builder, animation, camera rig, touch + desktop input
│  │     ├─ net/                     socket client, snapshot buffer, interpolation, reconnect
│  │     ├─ voice/                   WebRTC mesh, push-to-talk, speaking detection
│  │     ├─ atmosphere/              sun and moon, sky, fog, street lights, weather
│  │     ├─ photo/                   photo mode, filters, export with credits
│  │     └─ debug/                   hidden overlay, stats, "copy report"
│  └─ server/                        Express + ws + MongoDB — deploys to a small Node host
│     └─ src/
│        ├─ http/                    routes: areas, search, rooms, ice, health
│        ├─ realtime/                socket hub, room manager, snapshot loop, signalling relay
│        ├─ areas/                   Overpass client, elevation client, cache, single-flight
│        ├─ geocode/                 Nominatim client (1 request/second queue + cache)
│        ├─ store/                   Store interface → MemoryStore (dev) and MongoStore (prod)
│        └─ security/                rate limiters, origin check, name filter
├─ packages/
│  ├─ shared/                        used by web AND server
│  │  └─ src/  protocol/ (message types, binary codec, validators) · geo/ · constants.ts
│  └─ worldgen/                      pure TypeScript: no DOM, no Three.js → runs in the worker,
│     └─ src/                        on the server and in tests
│        pack/ (OSM → Area Pack) · terrain/ · buildings/ · roads/ · areas/ · props/ · chunk/
└─ tools/
   ├─ stress/                        8 fake clients with lag + packet loss
   └─ fixtures/                      saved map data for the test area (works offline, used by tests)
```

Rules: small modules (aim under ~250 lines), one job per file, tests sit next to the code as
`*.test.ts`. Commands: `npm run dev` (server + client, reachable from your phone), `npm test`,
`npm run stress`, `npm run build`.

---

## 5. Data flow: map → mesh

```
 pick a spot        SERVER — once per place, then cached            PHONE — world worker         PHONE — main thread
 lat/lng ─► areaId ─► Overpass JSON + elevation PNGs ─► Area Pack ─► index by chunk ─► arrays ─► meshes + colliders
```

**Step 1 — Pick.** The chosen lat/lng is snapped to a ~100 m grid to make an `areaId` (so two
friends picking almost the same spot reuse one cached pack). The exact spot is kept as the spawn point.

**Step 2 — Fetch (server).** On a cache miss the server makes **one** Overpass request for a
1.2 km square (1 km playable + 100 m margin so the edge isn't a cliff) and downloads a handful of
Terrarium elevation tiles (at most 4 for most places). If 8 friends ask at once, only one request goes out (*single-flight*).

**Step 3 — Build the Area Pack (server, `packages/worldgen/pack`).**
1. Convert lat/lng to local metres: x = east, z = south, y = up, origin = centre of the area.
2. Stitch multipolygons (buildings with courtyards, parks with holes), remove broken shapes.
3. Classify with tag tables (below): road type + width, building kind + height, ground kind.
4. Clip to the square and round to 10 cm.
5. Elevation: sample a 121 × 121 height grid (one point every 10 m), blur it (raw SRTM data is
   bumpy in cities), store as small integers.
6. Look up the time zone. Zip, save to MongoDB, send with long cache headers.

Expected pack size: about 60–150 KB zipped (raw OSM was 202 KB zipped).

**Step 4 — Prepare (phone, world worker).** Download with progress → build the terrain arrays →
paint parks/grass/sand/dirt into one **ground colour map** (a 1024 × 1024 texture; no extra
triangles, no flickering overlaps) → dig shallow basins for water → sort every feature into a
150 m chunk grid.

**Step 5 — Build a chunk (worker, on request).**
- **Buildings:** footprint → walls (with coordinates in metres for windows) + flat roof
  (`earcut`) → all buildings of the chunk merged into **one** mesh. Walls also continue 3 m below
  ground so nothing floats on slopes. Colour from a palette, seeded by the building's OSM id.
- **Roads:** centre line → cut into pieces ≤ 8 m → widened by road type → laid on the terrain
  8 cm above it. All roads of the chunk merge into one "ground overlay" mesh with kerbs and water.
- **Props:** only positions are produced (trees, lamps, benches). They are drawn with
  *instancing*: one tree model, hundreds of copies, one draw call.
- **Collision:** a simple triangle list of walls and roofs for Rapier (near chunks only).
- **Far version (LOD1):** simplified footprints, tiny buildings dropped.

**Step 6 — Show (main thread).** Arrays arrive without copying → 2 meshes per chunk + shared
materials → fade in. Rapier colliders are added for the chunks around you and removed when you leave.

### 5.1 Tag rules (the "plausible defaults")

**Building height**, first match wins:
1. `height` tag (understands "12", "12 m", "40 ft").
2. `building:levels` × 3.0 m + 0.5 m.
3. By type: house / detached / terrace → 2 floors · apartments / hotel / office / commercial → 5 ·
   retail / kiosk → 1–2 · school / hospital / civic → 3 · industrial / warehouse → 8 m ·
   shed / garage / hut → 3 m · place of worship → 9 m.
4. Unknown (`building=yes`): by footprint area — under 40 m² → 1 floor, under 150 → 2, under 400 → 3,
   under 1,500 → 4, larger → 5.
5. Guessed heights get ±1 floor of seeded variety so rows of houses don't look cloned. Tagged
   heights are never changed. `min_height` is respected.
6. *(added at STOP 1)* Apartment blocks with no height copy the middle floor count of mapped
   apartment buildings within 300 m, when at least two are known.
7. *(added at STOP 1)* Our own **height fixes** (`packages/worldgen/src/pack/heightFixes.ts`,
   keyed by OpenStreetMap id) win over everything above.

**Road width** (total, metres): motorway 15 · trunk 13 · primary 11 · secondary 9 · tertiary 7.5 ·
residential / unclassified 6 · living street 5 · service 3.5 · track 3 · pedestrian 5 ·
footway / path / steps 1.8 · cycleway 2. A `lanes` or `width` tag overrides the table.

**Invented, not real (because OSM has no data — see §2):** trees inside parks, gardens and scrub
and along streets; street lamps every ~35 m along roads; benches in parks. Positions are seeded,
so everyone sees the same ones.

**Known v1 limits:** flyovers and bridges are drawn flat on the ground; tunnels are hidden;
roofs are flat; shop and brand names from OSM are never shown.

---

## 6. Netcode

### 6.1 The numbers

| Setting | Value | Why |
|---|---|---|
| You → server (your state) | **15 per second** | smooth enough for walking and a scooter, light on mobile data |
| Server → you (*snapshot* of everyone) | **15 per second** (*tick rate*) | one small message instead of 7 |
| Others are drawn | **~130 ms in the past** (2 ticks), grows up to 400 ms on a shaky network | there are always two snapshots to blend between |
| If snapshots stop | keep moving the same way for 250 ms, then ease to a stop | hides short hiccups |
| When they resume | glide to the right place over ~200 ms; teleport only if more than 8 m off | no rubber-banding |
| Ping | every 2 s | shows lag in the debug overlay, syncs clocks |
| Silent for 10 s | others see a faded "reconnecting…" avatar | |
| Gone for 60 s | slot is freed | so a 9th friend can't steal a slot during a short drop |
| Reconnect tries | after 0.5, 1, 2, 4, 8 s… | automatic; you keep walking locally meanwhile |

### 6.2 Messages

- **Fast lane — binary, tiny, 15 Hz.** Your state is 13 bytes: sequence number, position
  (2 cm steps), facing, speed, flags (on ground / riding / talking / away / emote). A full 8-player
  snapshot is about 94 bytes → roughly **1.5 KB/s down, 0.2 KB/s up**.
- **Slow lane — JSON, readable, rare.** `join`, `welcome`, `player-joined`, `player-left`,
  `avatar`, `emote`, `rtc` (voice setup), `ping`/`pong`, `error`.

Every message type, its validator and the binary encoder/decoder live in `packages/shared/protocol`
so the client and server can never disagree, and all of it is unit-tested.

### 6.3 Lag and packet loss — in plain words

- WebSockets run on TCP, which re-sends lost packets by itself. So loss doesn't show up as
  missing data; it shows up as **a pause and then a burst**.
- Every snapshot contains the **full** state of everyone (no "changes since last time"), so a late
  or duplicate snapshot is simply ignored if a newer one already arrived. Nothing has to be repaired.
- The drawing delay adapts: the client measures how unevenly snapshots arrive (*jitter*) and
  widens the buffer when the network is shaky.
- Important things (join, leave, emote) are also written into the state itself, so even a missed
  event heals on the next snapshot.
- If a phone is too slow to keep up, the server **skips** snapshots for it instead of queueing
  them (queueing makes lag grow forever).
- **Honest limit:** on a really bad mobile connection other players will still freeze for a
  moment now and then. The later upgrade is sending positions over a WebRTC data channel — not in v1.

### 6.4 What the server checks ("validate every network message")

| Check | Rule |
|---|---|
| Size | binary state must be exactly 13 bytes · JSON ≤ 2 KB · voice-setup messages ≤ 12 KB · socket hard cap 16 KB |
| Shape | every JSON message goes through a hand-written validator; unknown types are dropped |
| Position | must be inside the area; a jump faster than 25 m/s is refused (the last good state is kept); repeated offences disconnect |
| Rate | *token buckets* per connection: state 20/s, control 10/s, voice setup in bursts — extra messages are dropped |
| Identity | the server stamps who sent each message; a client can never speak for someone else |
| Names | 1–16 characters, control characters stripped, small bad-word filter |
| Rooms | random 12-character id (about 60 bits) · max 8 enforced at join · no API lists rooms |
| Abuse | creating rooms, joining, searching and requesting new areas are rate-limited per IP (limits generous enough for 8 friends on one school Wi-Fi) |

### 6.5 Room lifecycle

`POST /api/rooms` creates a room for an area → the invite link is `/r/<roomId>` → a friend opens
it, picks a name and avatar → the socket sends `join` → the server answers `welcome` (your slot
0–7, who is here, a private session token used to reclaim your slot after a drop). When the last
player leaves, live state is freed after 60 s; the link itself keeps working for 24 h, then the
room document deletes itself (MongoDB TTL index). A server restart drops live sockets, but rooms
are in MongoDB, so clients reconnect and rejoin by themselves.

### 6.6 Voice

- WebRTC audio *mesh*: each player connects directly to each other player (7 connections at most).
  The server only passes the setup messages between members of the same room.
- **Push-to-talk by default**, plus a mute toggle. The mic permission is asked only when you first
  press Talk, never on page load. If denied you see a friendly note and can still listen.
- Echo cancellation, noise suppression and auto gain are on. Silence costs almost no data.
- "Who is speaking" comes from measuring audio level, shown on the name tag and player list.
- You can mute any single player on your own device.
- Not spatial in v1: everyone hears everyone, like a call.
- **Hard part — be warned:** phones on mobile data often cannot connect directly to each other.
  That needs a small relay called a *TURN* server (Question 3). The relay also has a privacy bonus:
  in "relay-only" mode nobody in the room can see anybody else's IP address.

---

## 7. World streaming design

**Why:** a phone can't hold a dense city at full detail, and building everything up front would
make loading slow.

**Data vs meshes:** the Area Pack (data) is downloaded once and is small. The **meshes** are what
we stream: built per chunk in the worker when needed, thrown away when far.

| Piece | Design |
|---|---|
| Grid | 8 × 8 chunks of **150 m** covering the 1.2 km square (inner 1 km is playable). Chunk size is one constant; Phase 3 measurements decide the final value. |
| Always loaded | terrain (one mesh, ~29,000 triangles), sky, ground colour map |
| Near ring | full-detail meshes (LOD0). Colliders only for the 3 × 3 chunks around you. |
| Far ring | simplified meshes (LOD1) out to the view distance |
| Beyond | unloaded. Fog starts before the view distance ends, so chunks appear inside the fog and you never see them pop in. |
| Props | one global instanced mesh per prop type (tree, far-tree, lamp, bench…), refilled from the loaded chunks' position lists when you cross into a new chunk → about 6–8 draw calls for all props in the world |
| Load order | nearest first, with a bonus for chunks in front of the camera |
| Per-frame limits | at most 2 chunks being built in the worker, **1 chunk uploaded and 1 collider built per frame** (≤ 4 ms) so walking never stutters |
| No flip-flopping | a chunk loads at distance D but unloads only at D + 30 m (*hysteresis*) |
| Detail swap | the far version stays visible until the near version is ready → never a hole |
| Unload | geometry freed on the GPU, collider removed, arrays released |
| Culling | Three.js skips any chunk mesh outside the camera view (*frustum culling*) automatically |
| First spawn | loading screen stays until terrain + the 3 × 3 chunks around spawn + their colliders are ready |
| Memory guard | if geometry memory passes the budget the rings shrink one step and the debug overlay says so |
| World edge | invisible soft wall at the 1 km square, fog beyond it, and a friendly "edge of this Nukkad" hint |
| Spawn | the nearest street corner to the chosen spot, marked by a small glowing meeting-point marker — the Nukkad |

View distances: Low 200 m · Medium 350 m · High the whole area.

---

## 8. Performance budget

### 8.1 By quality level (what is on screen at once)

| | Low | **Medium — the mid-range Android target** | High |
|---|---|---|---|
| Frame target | 30 fps | **30 fps (33 ms)** | 60 fps |
| Resolution | 0.7–1.0 × screen points | pixel ratio ≤ 1.5 | pixel ratio ≤ 2 |
| View distance | 200 m | 350 m | 600 m |
| *Draw calls* | ≤ 60 | **≤ 100** | ≤ 200 |
| Triangles | ≤ 80,000 | **≤ 150,000** | ≤ 400,000 |
| Shadows | soft blob under avatars only | one 1024² sun shadow map, 60 m range | 2048², 120 m range |
| Trees shown | ≤ 300 | ≤ 1,000 | ≤ 2,500 |
| GPU texture memory | ≤ 12 MB | **≤ 24 MB** | ≤ 48 MB |
| Geometry memory | ≤ 8 MB | ≤ 16 MB | ≤ 32 MB |
| Extra effects | none | none (filters only in photo mode) | light |

Resolution also adapts while playing: if frames get slow for 2 seconds the render scale drops 10 %
(not below 0.6); if there is headroom it climbs back.

### 8.2 Per chunk (150 m × 150 m)

| Item | Budget | Test area (my estimate) |
|---|---|---|
| Draw calls | **2** (buildings, ground overlay) + 1 if the chunk has water | — |
| Triangles, full detail | **≤ 30,000** — a hard cap: the worker simplifies until it fits, and a test checks it | ≈ 600 average |
| Triangles, far detail | ≤ 10,000 | ≈ 250 |
| Vertex memory | ≤ 1.5 MB at the cap · ≈ 0.3 MB in a dense city | ≈ 30 KB |
| **Texture memory of its own** | **0 MB** — every chunk shares the global textures below | 0 |
| Collider | only the 3 × 3 chunks around you | — |
| Build time in the worker | ≤ 30 ms | — |
| Cost on the main thread | ≤ 4 ms in the frame it appears | — |

### 8.3 Global textures (Medium)

| Texture | Size | Memory |
|---|---|---|
| Facade atlas (windows, walls, shutters) | 1024² | 5.6 MB |
| Ground colour map | 1024² | 5.6 MB |
| Ground detail + sky noise | 2 × 256² | 0.7 MB |
| Sun shadow map | 1024² | ≈ 4 MB |
| Name tags | 8 × 256 × 64 | 0.5 MB |
| **Total** | | **≈ 17 MB (budget 24 MB)** |

### 8.4 One frame on Medium (33 ms)

Physics ≤ 2 ms · game logic + network ≤ 2 ms · streaming ≤ 4 ms (only in frames that add a chunk) ·
Three.js preparing draw calls ≤ 6 ms · GPU ≤ 18 ms. Rule: nothing on the main thread except
rendering may take more than 4 ms.

### 8.5 Download and loading

| Item | Budget |
|---|---|
| JavaScript + WASM | ≤ 1.2 MB zipped (Rapier is ≈ 0.7 MB of that — to be measured — and loads while the menu is showing) |
| Area Pack | ≤ 150 KB zipped typical |
| Time to walking, place already cached, Wi-Fi | ≤ 8 s |
| Time to walking, brand-new place | 20–40 s (waiting for OpenStreetMap) with an honest progress message |
| Voice | ≈ 3 KB/s per person who is talking, ≈ 0 when silent |

---

## 9. How the safety, privacy and legal rules are enforced

| Rule | How the design enforces it |
|---|---|
| No signup | name + avatar live in your browser's localStorage and in server memory while you are connected. **Never in MongoDB.** |
| Friends-only | the random room id in the link is the only way in · no room list · join attempts rate-limited · cap of 8 checked by the server · no text chat at all |
| Store as little as possible | MongoDB holds only: `rooms` {id, areaId, spawn spot, timestamps}, `areas` (public map data), `geocache` (search text → results, linked to nobody). Our code writes no IP logs. |
| Never store voice | audio goes browser ↔ browser (or through an encrypted relay). The server never receives audio. |
| Never store real location | the Geolocation API is never used — a test fails the build if `navigator.geolocation` appears in the code. "Location" always means the map spot chosen. |
| OSM attribution | "© OpenStreetMap contributors" link always visible in the HUD · credits screen · burned into every saved photo next to the Nukkad name |
| Nominatim policy | server-side only · global queue of 1 request per second · results cached 30 days · search runs when you press Enter (the policy forbids autocomplete) · User-Agent with app name + contact |
| Overpass fair use | each place fetched once, then cached for 30 days after its last use · one request in flight · per-IP limit on new areas · far below the public server's 10,000 requests/day guideline |
| Open data only | OSM via Overpass · Mapzen Terrarium elevation tiles (AWS Open Data) · OSM map tiles only inside the place picker. No Google SDKs, maps or fonts. |
| No brands, no ripped assets | shop and brand names from OSM are never drawn · buildings, avatars, scooter, textures and sounds are generated by our own code · `CREDITS.md` lists every library, data source and licence |
| Photos | made on your device, never uploaded to our server · the place name on a photo is opt-in (off by default) |

---

## 10. Risk list

Sorted roughly by how much they worry me.

| # | Risk | Chance | Hurts | What we do |
|---|---|---|---|---|
| 1 | **Voice fails between phones on mobile data** without a TURN relay | High without TURN | High | set up a TURN relay (Question 3) · test on two different networks on Day 4 · without it, voice ships labelled "may not connect on mobile data" |
| 2 | **30 fps on a mid-range Android is not reached** | Medium | High | measure on your real phone from Day 1 (the debug page) · budgets in §8 · three quality levels · adaptive resolution · shadows are the first thing to go |
| 3 | **Day 4 is overloaded** (voice + photo + scooter + polish + deploy) | High | Medium | voice starts Day 3 evening · basic menus and first deploy pulled into Day 3 · strict cut order · no half features |
| 4 | **Public Overpass is slow or down** (18–34 s measured today) | High | High | each place is fetched once and cached for 30 days after its last use · single-flight · a second mirror server · bundled test area · honest loading text + retry screen. Plan B: OSM vector tiles (less precise shapes) |
| 5 | **OSM is incomplete** — here 64 % of heights are guessed, 4 trees, 0 lamps; other places may miss buildings entirely | Certain | Medium | height rules + seeded variety · invented trees and lamps · some neighbourhoods will look sparse and code can't fix that in v1 |
| 6 | **I can't test some things myself:** real phone speed, real microphones between two devices, iPhone, mobile networks | Certain | Medium | you test at the 3 stops and on Days 5–6 with TESTING.md · the debug overlay has a "copy report" button to paste to me · bots + a fake-mic mode cover what can be automated |
| 7 | **Teens + voice:** a leaked link lets a stranger join; direct voice shows IP addresses to room members | Low–Medium | High | unguessable links · cap 8 · no lists · per-player mute · relay-only voice (Q3) · host lock/kick (Q5) · no text chat · no GPS · nothing stored about users · a short, plain privacy page. Laws about apps used by under-18s can apply even to small apps, so before a wider public launch ask a parent or guardian to read that page with you. |
| 8 | Terrain, roads and buildings don't line up (flicker, floating houses, bumpy ground) | Medium | Medium | blurred height grid · roads laid 8 cm above terrain with depth offset · building walls continue below ground |
| 9 | iPhone Safari quirks (audio changes when the mic turns on, no fullscreen, 3D context lost in background, tight memory) | Medium | Medium | handle context loss and resume · safe-area layout · **needs a real iPhone** (Q2); if nobody has one, iPhone launches as "best effort, untested" |
| 10 | Kerbs and sidewalks get messy at junctions | Medium | Low | simple raised bands trimmed near junctions · fallback is a painted kerb line · step-up is tested on a fixed test step either way |
| 11 | TCP stutter on lossy networks (see §6.3) | Medium | Low–Medium | interpolation + adaptive delay · stress test with loss |
| 12 | The mic needs HTTPS even on local Wi-Fi | Certain | Low | the dev server uses HTTPS with a self-signed certificate (one "proceed anyway" tap on the phone) · fallback: a free tunnel |
| 13 | Free Node hosts sleep when idle (first join after a break can take ~30–60 s) and restarts drop live rooms | Medium | Low–Medium | "waking the server…" loading text · rooms saved in MongoDB · clients rejoin automatically |
| 14 | Tools newer than I know best (TypeScript 7, Vite 8, Rapier 0.21) | Medium | Low | read docs first · pin the previous major if needed |
| 15 | Someone abuses our API to make us hammer OSM servers | Low | Medium | per-IP limits · global queues · grid-snapped areas so repeats hit the cache |
| 16 | "Nukkad" is a common word and other products use it | Low | Medium | quick app-store and trademark name search before public launch · only our own wordmark, no borrowed logos |
| 17 | Flyovers flat, tunnels hidden, flat roofs only | Certain | Low | written down as v1 limits · TODO after launch |

---

## 11. Four-day schedule

**Proposed change to your phase list (needs your OK — Question 1):** your phases build emotes
(priority 10), weather (9) and facade variety (11) *before* voice (6), photo mode (7) and the
scooter (8). If time ran out, the wrong things would get cut. So I keep your phase numbers but
move those three into an **Extras** slot at the end of Day 4. Their hooks are built early (an
emote field in the protocol, a weather knob in the sky shader, a seed on every building), so adding
them later is cheap and nothing is ever half-working.

| Day | Phase | What gets built | Done when | Stop? |
|---|---|---|---|---|
| **1** Tue | Setup | repo, workspaces, strict TS, tests, HTTPS dev server with a QR code for your phone, NOTES.md, BUGS.md, CLAUDE.md, `.env.example`, first commit | `npm run dev` and `npm test` work | |
| | **1 Map → 3D** | area service (Overpass + elevation + cache + bundled test area), Area Pack builder, world worker, terrain, buildings, roads, parks, water, trees + lamps (instanced), merged meshes, debug page with free-fly camera and FPS / triangle / draw-call counters, map → mesh tests | the test area shows in 3D on your phone · a second place loads by changing lat/lng in the URL · tests green | **STOP 1** |
| | 2 (start) | Rapier loaded, capsule walking on the terrain | | |
| **2** Wed | **2 Movement** | collisions with buildings, slopes, step-up, third-person camera that doesn't clip through walls, joystick + drag-to-look, WASD + mouse, avatar built in code + walk animation + customiser (colour, outfit, hair) | you can walk the test area on phone and laptop without falling through or getting stuck | |
| | **3 Streaming + speed** | chunk streaming, LOD, texture atlas, quality levels + auto benchmark, debug overlay v1 with "copy report", profiling, fix the worst bottleneck | a report with real fps / draw calls / memory from your phone and my laptop · 30 fps on your phone, or an honest gap + plan | **STOP 2** |
| | 4 (start) | server rooms + message protocol | | |
| **3** Thu | **4 Multiplayer** | invite-link rooms (max 8), 15 Hz state sync, interpolation, reconnect, name tags, landing page (name → join), basic Invite button, stress test with 8 bots + lag + loss, protocol and room tests, **first deploy** if the accounts exist | two real devices see each other move smoothly · stress results in NOTES.md | |
| | **5 Atmosphere** | sun and moon from the place's real local time, sky, soft fog, street lights and window glow at night | the place looks right for its current time · a debug slider shows the whole day | **STOP 3** |
| | 6 (start) | voice signalling + mic permission flow | | |
| **4** Fri | **6 Voice + photo** | push-to-talk, mute, speaking indicator, mic-denied flow · photo mode: UI hidden, free camera, filters, save/share with Nukkad name + OSM credit | two devices talk · a saved photo carries both credits | |
| | **7 Scooter + polish** | scooter (grip, lean, camera FOV kick), loading screen with progress, place picker (search + map pin), friendly error screens, settings (quality, controls, sensitivity), README with run + deploy steps, TESTING.md, CREDITS.md | ride toggle works and friends see you riding | |
| | Extras | only if everything above works, in this order: weather → emotes → facade variety | each one fully works or stays a stub | |
| | Final | deploy, run the Day-4 checklist on real devices, update NOTES.md and BUGS.md | checklist below is all ticked | |

### 11.1 Day-4 definition of done

On the **deployed** site, using real devices:

1. Open the link on a phone → type a name → search or pin a place → the world loads behind a
   progress bar → you walk with the joystick at about 30 fps on the mid-range Android.
2. Tap **Invite friends** → a second device opens the link → picks a name → both see each other
   move smoothly with name tags. 8 players verified with real devices + bots.
3. Voice: push-to-talk works between two devices on **different networks**, mute works, the
   speaking indicator shows, and a denied mic gives a friendly message while listening still works.
4. Photo mode hides the UI, has a free camera and at least 3 filters, and saves or shares an
   image carrying "Nukkad" and "© OpenStreetMap contributors".
5. The scooter works and others see you riding.
6. Light matches the real local time of the place, and street lights are on at night.
7. Leaving frees your slot, a dropped connection reconnects by itself, and a full room says so nicely.
8. `npm test` is green · `npm run stress` passes its thresholds · the debug overlay works.
9. README, TESTING.md, CREDITS.md, `.env.example`, NOTES.md and BUGS.md are present and current.
10. No crash-level bug is open. Everything that was cut is a stub with a TODO in NOTES.md.
11. OSM attribution is visible in the UI.

**Honest capacity note:** Day 4 is the fullest day. If it slips, the cut order is: facade variety →
emotes → weather → scooter polish. Voice without a TURN relay may be marked "works on Wi-Fi,
unreliable on mobile data" — that is a setup issue, not a code issue.

---

## 12. Debug and test tools (built during Days 1–4, used on Days 5–6)

| Tool | What | Built in |
|---|---|---|
| Debug page | `debug.html`: any lat/lng, free-fly camera, FPS / triangles / draw calls, wireframe and chunk-border toggles | Phase 1 |
| Hidden overlay | toggle with 5 quick taps on the Nukkad logo (laptop: the `` ` `` key): fps, frame time, ping, late snapshots %, voice packet loss, players, draw calls, triangles, memory, current chunk, quality level + **Copy report** button | Phase 3, grows in 4 and 6 |
| `npm test` | map → mesh (bundled fixtures, broken shapes, budgets, same input → same output), message validation, binary encode/decode, room logic (cap 8, rejoin, expiry, rate limits), "no geolocation" guard | every phase |
| `npm run stress` | 8 fake clients, random lag 50–400 ms, 0–10 % loss → report of snapshot rate, delays, server CPU and memory, errors | Phase 4 |
| TESTING.md | checklist for low-end Android, mid-range Android, iPhone, laptop: join / leave / rejoin, bad network, tab in background, rotating the phone, mic denied, 8 players, switching places, 30-minute memory-leak session | drafted Phase 4, finished Day 4 |
| BUGS.md triage | crash → wrong behaviour → performance → cosmetic, fixed in that order | from Day 1 |

---

## 13. Decisions I made for you — veto any of them

| # | Decision | Why |
|---|---|---|
| 1 | Stylised low-poly look with textures painted by code | fast on phones, legally clean, no photos needed |
| 2 | Avatars and the scooter are built in code, not downloaded models | zero licence risk, tiny download, easy colour / outfit / hair options that suit everyone |
| 3 | Everyone has their own scooter — tap **Ride** | nobody fights over vehicles; much simpler to sync |
| 4 | React for menus and HUD only | you know it; the game itself stays plain Three.js |
| 5 | No text chat | voice with friends only; less to moderate |
| 6 | No "use my location" button | the app never touches GPS, by design |
| 7 | Search runs on Enter, plus a map where you can drop a pin | Nominatim forbids autocomplete; the pin rescues places search can't find |
| 8 | World is a 1 km square with a soft edge | matches "~500 m around the spot" |
| 9 | Spawn at the nearest street corner, with a small meeting-point marker | that corner *is* the Nukkad |
| 10 | Voice is not spatial in v1 | spatial audio fights with echo cancellation on phones |
| 11 | Day-night follows real local time; photo mode gets its own time slider that only you see | keeps the rule, still lets you take a sunny photo at night |
| 12 | Dev runs on HTTPS with a self-signed certificate | the mic and the Share button only work on HTTPS |
| 13 | In dev with no MongoDB: memory + a small disk cache, so restarts don't re-ask OpenStreetMap | polite to the public server, faster for us |
| 14 | Trees and street lamps are mostly invented | OSM has 4 trees and 0 lamps here |
| 15 | Movement is trusted to each phone with server sanity checks | see §3.2 C |

### Open questions (the five I need answered)

1. **Build order vs your priority list.** OK to move emotes, weather and facade variety to the end
   of Day 4, after voice, photo mode and the scooter? *(My pick: yes — see §11.)*
2. **Test phones.** Which exact Android model(s) will you test on, and does anyone have an iPhone?
   *(If no iPhone: it launches as "best effort, untested".)*
3. **Accounts, budget and voice relay.** Do you have (or can you make, maybe with a parent)
   MongoDB Atlas, Vercel and one Node host account? Is the budget ₹0? And may I add a TURN relay
   for voice in relay-only mode (more private, works on mobile data, needs one more free account)?
   *(My pick: Atlas free tier + Vercel free + Render free to start — I'll confirm current free-tier
   terms before we depend on them — and TURN relay-only.)*
4. **Contact line + repo.** OSM services require our server to identify itself with a contact
   (an email or a URL). What may I use — I will not use your personal email — and will the GitHub
   repo be public or private? *(If public and the test area is near your home, I'd switch the
   built-in default place to a famous public spot before publishing.)*
5. **Room rules.** OK that an invite link keeps working for 24 hours after everyone leaves? And do
   you want the room creator to be able to lock the room and remove a player? *(My pick: yes to
   both; lock/remove is a few hours and would sit just above weather in the priority list.)*

---

## 14. Glossary

| Word | Meaning |
|---|---|
| Area Pack | our own small file holding everything about one place: roads, buildings, ground types, heights |
| Chunk | one 150 m × 150 m square of the world that loads and unloads as a unit |
| Draw call | one "draw this mesh" order to the graphics chip. Phones choke on too many, so we merge meshes |
| Instancing | drawing many copies of one model (trees, lamps) with a single draw call |
| LOD | level of detail: a simpler version of a mesh used when it is far away |
| Frustum culling | not drawing things that are outside the camera's view |
| Hysteresis | using different distances for loading and unloading so chunks don't flip-flop at a border |
| Tick rate | how many times per second the server sends updates |
| Snapshot | one server message containing everyone's position at one moment |
| Interpolation | drawing other players slightly in the past and blending between two snapshots so they move smoothly |
| Jitter | how unevenly messages arrive |
| Token bucket | a rate limiter: you get N tokens per second, each message costs one |
| Single-flight | if many people ask for the same thing at once, do the work once and share the answer |
| Mesh (voice) | every player connects directly to every other player |
| STUN / TURN | helpers that let two browsers find each other. TURN relays the audio when a direct link is impossible |
| WASM | fast compiled code running in the browser (our physics engine) |
| Web worker | a background thread in the browser, so heavy work doesn't freeze the screen |
