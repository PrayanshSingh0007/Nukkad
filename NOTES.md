# Nukkad — NOTES

Read order for a fresh session: PLAN.md → this file → BUGS.md.

## Current status (2026-11-11, night)

- **Phases 1–3 are built. Waiting at STOP 2 (after Phase 3) for the owner's phone numbers.**
- `npm test`: 89 green · typecheck clean · build works.
- Git: repo made by the owner — github.com/PrayanshSingh0007/Nukkad (main). **Commit and push at the end of every phase.**
- Schedule: about half a day behind (Phase 3 was planned for Day 2; Phase 4 has not started).

## Phase 3 — what was built

- **Streaming** (`apps/web/src/world/streamer.ts`, `streamPlan.ts`): full-detail chunks in the 3 × 3 (High: 5 × 5) around the player, simplified far chunks out to the view distance, nothing beyond. 30 m hysteresis, nearest-first with a bonus for chunks in front, at most 2 chunks building in the worker and 1 put on screen per frame. A far chunk stays visible until its near version replaces it (no holes). Removed chunks free their GPU memory.
- **Far chunks (LOD1)** (`buildChunk(…, 1)`): no buildings under 100 m², outlines simplified to 1.5 m, no courtyards, no window data, only roads ≥ 5 m wide in 18 m pieces, no road-end discs. Cap 10,000 triangles.
- **Quality levels** (`apps/web/src/game/quality.ts`): Low 200 m / pixel ratio 1 / 300 trees · Medium 350 m / 1.5 / 1,000 · High 600 m / 2 / 2,500 + anti-aliasing. First level guessed from the device, then a 6-second benchmark steps a *guessed* level down while frames average over 40 ms. A level picked by hand (overlay buttons) or `?q=low|medium|high` is never changed. Saved in the browser.
- **Adaptive resolution**: render scale drops 10 % after 2 s of frames over 36 ms (not below 0.6), climbs back under 22 ms.
- **Hidden debug overlay**: 5 quick taps on the "Nukkad" logo (laptop: the ` key): fps, frame time, draw calls, triangles, geometries, textures, JS memory, quality, render scale, chunks near/far/building, colliders, current chunk, position, pack size, load time, quality buttons, **Copy report** (on plain http it opens a box to copy by hand).
- **Download fixed (B-004)**: Rapier now comes as a separate `.wasm` file (package `@dimforge/rapier3d` + `vite-plugin-wasm`), loaded in parallel with the map. Zipped: app 76 KB + Three.js/world 142 KB + physics JS 52 KB + physics WASM 1,169 KB ≈ **1.44 MB** (was 1.75 MB; budget 1.2 MB — still over, because the physics engine alone is 1.17 MB).
- Not done from PLAN §7–8: sun shadow maps (everyone has the blob shadow on every level), texture atlas (there are no facade textures — windows are drawn by the shader, so there is nothing to atlas), memory guard that shrinks rings, per-chunk tree refill (trees are one capped global list; fog hides far ones).

### Phase 3 measurements (laptop M1 Max, browser pane, simulated 60 Hz frames)

| Level | Chunks on screen | Draw calls | Triangles |
|---|---|---|---|
| Low | 16 (9 near + 7 far) | 22 | 53,000 |
| Medium | 32 (9 + 23) | 32 | 70,000 |
| High | 59 (25 + 34) | 48 | 105,000 |

All under the PLAN §8.1 budgets (60 / 100 / 200 draw calls; 80k / 150k / 400k triangles). Far chunks are ≈ 40 % lighter than near ones here. A 143 m walk across a chunk border never dropped below 9 near chunks / 9 colliders; GPU geometry count stayed flat (no leak). Map ready 0.6 s after load for a cached place. **Phone fps: unknown until the owner measures it.**

## Phase 2 — what was built

- **Game page** at `/` (`apps/web/index.html` → `src/main.tsx`): loads the place from `?lat=&lng=` (default: test area), spawns the player at the street point nearest the centre. The debug fly page stays at `/debug.html`.
- **Physics** (`src/physics`): Rapier 0.21. The ground collider is the drawn terrain mesh itself (so no diagonal mismatch is possible). Buildings **and road strips** of the 3 × 3 chunks around the player are trimesh colliders, added and removed as the player crosses chunk borders.
- **Walking** (`src/game/localPlayer.ts`, `src/physics/characterBody.ts`): capsule 1.7 m × 0.6 m, Rapier character controller with step-up 0.4 m, snap-to-ground 0.4 m, climbs up to 50°, 5 m/s, fixed 60 Hz physics steps with smoothing between steps, soft world edge 100 m inside the area, rescue if someone falls under the ground.
- **The kerb** is the 8 cm road strip: you really step up onto roads and down off them.
- **Camera** (`src/player/cameraRig.ts`): third person, 5.2 m back; a ray from the player to the camera pulls it in front of walls.
- **Controls** (`src/player/input.ts`): phone = left-side stick + drag to look; laptop = WASD/arrows + drag to look, Shift = slow walk.
- **Avatar** (`src/player/avatar`): built from boxes in code, ONE skinned mesh = one draw call per player, 7 bones, walk/idle animation made with maths, blob shadow. Customiser ("Your look"): 6 skin tones, 6 hair styles, 9 hair colours, 4 outfits (tee, hoodie, kurta, jacket), 10 colours — all open to everyone. Saved only in the browser (`localStorage`). The options and their validator live in `packages/shared/src/avatar.ts` (the server will reuse them in Phase 4).
- **React 19** is now installed, for the UI layer only (`src/ui`).

### Phase 2 measurements (laptop, scripted in the browser)

- Walks 75.8 m in 15 s (5.05 m/s), never airborne on flat streets.
- Walking into a wall: stops 0.33 m from it (0.30 m body + 0.03 m skin) and slides along it.
- Kerbs: 4 step-ups and 12 step-downs in 12 walks from the spawn point; largest height change in one physics step 4.7 cm; slowest speed right after a step-up 4.4 m/s (no stall).
- Camera with its back to a wall: pulls in to 0.6 m, returns to 5.2 m.
- Colliders: always 9 chunks. Game page from the spawn point: ≈ 75–81 k triangles, 46–51 draw calls.
- **Download is over budget:** the game page is 1,745 KB zipped, of which Rapier is ≈ 1,650 KB (its WASM is 3.1 MB, and the "compat" package embeds it as text). Budget was 1,200 KB. See BUGS B-004.

### Phase 2 — not verified

- Touch stick + drag on a real phone (only simulated touches were tested), fps while walking on a phone, slopes steeper than the test area has.

## What exists

| Part | Where | State |
|---|---|---|
| Area Pack format, geo maths, seeded random | `packages/shared` | done, tested |
| OSM → Area Pack (tags, heights, clipping, multipolygons, building parts) | `packages/worldgen/src/pack` | done, tested |
| Terrain, buildings, roads, water, ground colour map, trees/lamps/benches, chunks | `packages/worldgen/src` | done, tested |
| Server: `/api/areas`, `/api/health`, Overpass + elevation clients, cache, rate limits | `apps/server` | done, tested |
| MongoDB area cache | `apps/server/src/store/mongoAreaStore.ts` | **written, never run against a real MongoDB** |
| World worker + Three.js view + debug page | `apps/web` | done, checked in a desktop browser |
| Saved test-area data (works offline) | `tools/fixtures/a_12921_77695_600` | done |

## Measured numbers (test area, laptop M1 Max — NOT a phone)

- Map: 1,837 buildings (1,194 = 65 % heights guessed), 33.9 km roads/paths, 106 ground areas, 15 mapped trees, 0 mapped lamps.
- Pack: **65 KB zipped** (budget 150). A dense tourist centre measured 207 KB before the compact encoding, ≈ 139 KB estimated after (not re-fetched).
- New place from OpenStreetMap: 39 s and 45 s in two tries. Cached place: ~0.1 s.
- Worker: prepare ≈ 50 ms, all 64 chunks ≈ 10–20 ms, slowest chunk 2.4 ms (budget 30 ms).
- Triangles: chunks 37,724 (buildings 23,164 + roads 14,560), terrain 28,800, water 182. Biggest chunk 1,849 (cap 30,000). Chunk geometry 1.6 MB.
- Whole area in view: **≈ 90,700 triangles, 82 draw calls** with 1,000 trees and 648 lamps (2,622 trees are generated; the page draws the first 1,000).
- Download: page 142 KB zipped (includes Three.js), worker 11 KB.
- fps: 120 on the laptop. **Phone fps is unknown** — only the owner can measure it.

## Answers to the five questions

1. Build order — approved: emotes, weather, facade variety move to "Extras" at the end of Day 4.
2. Test phones — **not answered**. iPhone is "best effort, untested" until told otherwise. Ask for the Android model.
3. Accounts — picks approved: Atlas free + Vercel free + Render free, budget assumed ₹0, TURN relay-only. Accounts not created; free-tier terms not yet checked.
4. Contact + repo — **not answered**. `OSM_CONTACT` is empty; a production server refuses to start OSM calls without it. Never use the owner's personal email. Change the built-in default place before any public publish.
5. Room rules — approved: link lives 24 h; creator can lock and remove (just above weather in priority).

## Decisions made (beyond PLAN.md)

- **No extra TypeScript runner.** Node 24 runs `.ts` files directly, so imports use `.ts` endings, `tsc` only checks types, and the server starts with `node src/index.ts`. (tsx was dropped.)
- **STOP 1 feedback (Nov 11):** the owner saw that the test-area apartment blocks looked nothing like the real ones. The map has only plain outlines with no floor counts for them. Added two rules: (a) apartment blocks with no height copy the middle floor count of mapped apartment buildings within 300 m when at least two are known — the ten blocks are now 16 floors; (b) `packages/worldgen/src/pack/heightFixes.ts` holds our own per-building corrections (empty so far — **waiting for the real floor counts from the owner**). Exact architecture (balconies, shapes) is not possible from open data; "facade variety" stays an Extra.
- **After changing a height fix or any pack rule, raise `PACK_VERSION`** (now 3) so server and browser caches are rebuilt.
- **Pack wire format:** points as flat lists per kind; coordinates and heights stored as differences (`encodePack` / `decodePack` in `packages/shared/src/pack/codec.ts`). ~30 % smaller.
- **The pack version is part of the request address** (`&v=<PACK_VERSION>`), so a browser never reuses an old cached pack; a mismatch gets a 409 that is never cached.
- Area id: `a_<lat×1000>_<lng×1000>_<halfSize>`; `halfSize` 150–600 in steps of 150 (`&r=`).
- Local coords: x east, z south, y up, y = 0 at the lowest ground of the area. Pack coords are whole decimetres.
- Outer rings have positive signed area in (x, z); outward wall normal of edge (dx, dz) is (dz, 0, −dx). Up-facing triangles are checked, not assumed (`addTriangleFacing`).
- Terrain cells split along the (i+1,j)–(i,j+1) diagonal; `heightAt` uses the same split. **Phase 2: check Rapier's heightfield diagonal and match it.**
- Roads: strips cut every ≤ 6 m, lifted 3–11 cm by kind (so overlaps never flicker) + polygon offset; hexagon discs at road ends fill corner notches. **The road lip is the "kerb" in v1** — no raised sidewalks.
- Ground colours (parks, pitches, parking…) are painted into one 1024² texture by our own scanline fill.
- Water: a sheet 5 cm above the original ground; ground inside lakes is lowered 0.6 m, except within 6 m of a road (bridges keep solid ground).
- Buildings: walls reach 3 m below the lowest ground under them; flat roofs; outlines that contain `building:part`s are replaced by the parts; `building=roof/carport` are thin slabs.
- Windows are drawn by the shader from two numbers per vertex (window column, floor) and fade with distance.
- Trees/lamps/benches: mapped ones are kept; the rest are seeded. Street lamps are skipped when ≥ 30 are mapped, street trees when ≥ 300 are mapped. Lists are shuffled so "first N" is evenly spread.
- Elevation: Terrarium zoom 14 (drops near the poles), blurred 3×; sea floor clamped to 0 on coasts; missing tiles → flat ground + a flag.
- Server: one map build at a time, single-flight per place, "busy" after 8 queued; per IP 60 requests/min and 6 new places then 2/min.
- Dev server port is always 8787 (`NUKKAD_SERVER_PORT` overrides); `PORT` is only for hosting.

## Not done / known limits

- Phone fps and the https dev mode on a phone are **unverified** (https starts fine; my browser refuses self-signed certificates).
- MongoDB store is untested (no local MongoDB; needs an Atlas URI or Docker started by the owner).
- No streaming yet: the debug page loads all 64 chunks. 82 draw calls for the whole area is above the Medium budget only if everything is in view — Phase 3 (view distance, LOD) deals with it.
- Not drawn: walls/fences/hedges (data is fetched), sea/coastline, bridges as bridges (flat), tunnels (hidden), roof shapes (see BUGS B-001).
- Places within ~1 km of the ±180° date line are not handled.
- Exact elevation credit wording still to be copied into a credits screen (CREDITS.md TODO).
- TESTING.md does not exist yet (planned for Phase 4).

## Known bugs

See BUGS.md: B-001 (special roofs as blocks), B-002 (lake patches), B-003 (soft park edges) — all cosmetic.

## Next steps

1. Owner (STOP 2): open `/` on the phone, walk 2 minutes, open the overlay (5 taps on the logo), tap Copy report and send it. Tell me the phone model.
2. Phase 4 — multiplayer: shared protocol + validators, ws server with rooms (max 8, invite link, rate limits, expiry), 15 Hz state / snapshots, interpolation, reconnect, name tags, emote field, landing page (name → join), Invite button, 8-bot stress test with lag + loss.
3. Question 5 decision is in (24 h links, host lock/remove) — remove goes just above weather.
