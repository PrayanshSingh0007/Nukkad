# Nukkad — NOTES

Read order for a fresh session: PLAN.md → this file → BUGS.md.

## Current status (2026-11-13)

- **Owner's goal now (2026-11-13): "a Bengaluru open-world game like GTA" — an original game in that style, friendly, NO violence** (owner picked "Friendly, no violence"). Must-haves in their words: real Bengaluru apartments, schools, malls (e.g. "VR Bengaluru") where friends gather and go together; **drive any vehicle**; **live traffic & people**.
- Order: drive any vehicle (DONE) → live traffic (DONE) → people walking (DONE) → people walking → place search + "Take everyone there" → real place names (needs the owner's OK: it bends their own "no shop signage" rule — names would be map labels/plain boards, never logos).
- Never copy GTA's name, characters, art or missions (Claude's rule: genre yes, recreation no).
- `npm test` 122 green. Phone fps still unknown.

## Emotes (2026-11-13)

- **Emote** button (or keys 1–4): Wave (2.6 s), Dance, Sit, Talk — friends see it (flags bits 4–7 carry the emote when not riding; no protocol change). Sit works only near a seat: street benches outside; sofas, chairs, school/mall benches, hotel sofas inside. Moving ends any emote; moving while seated stands you up.
- Verified with two players in one flat: one sitting on the sofa, the other dancing, both seen on the first player's screen.
- Limits: sitting outdoors snaps to the bench middle (no "seat taken" check — two friends can sit in the same spot).

## Rooms survive restarts (2026-11-13, B-005 fixed)

- `apps/server/src/store/roomStore.ts`: FileRoomStore (dev, `.cache/rooms/rooms.json`, atomic writes, ≤ 2 writes/s) and MongoRoomStore (prod, untested). Stored: room id, lat, lng, createdAt, emptySince — never names, looks or positions. Players re-join as new members after a restart (their reconnect tokens were in memory); live positions are simply lost, as before.

## Real 3D people (2026-11-13) — owner: "Yes, find models"

- Players and friends are now **Quaternius' CC0 Universal Base Characters** (two rigged bodies, ≈ 14k triangles, detailed faces, real hair models) moved by the **CC0 Universal Animation Library** (idle, walk, jog, sprint, jump, driving, sitting, talking, dance — matched to speed). Credits in CREDITS.md. The built-in body shows until the files load (≈ 2.4 MB in total, loaded after the world).
- `tools/characters/build.mjs <folder with the unzipped packs>` rebuilds `apps/web/public/models/people/`: 1024 px skin/normal textures (JPEG), 512 px hair, only 12 clips with finger/translation/scale tracks removed (anims 174 KB).
- The bodies come without clothes, so **clothes are painted on in a shader** (`people.ts`): each vertex knows its main bone and height → shirt (tee = elbow sleeves, others long), kurta down to the knees, trousers, shoes; cloth has no skin detail map and is rougher; a darker hem band at the waist. Skin: tones 0–2 use the light skin picture, 3–5 the dark one, each tinted. Hair colours tint the hair picture.
- New neutral look option **Build 1 / Build 2** (anyone can pick either; old saved looks default to Build 1). Hair names now: Short, Long, Bun, Crop, Buzz, None (cap removed — no cap model).
- Honest limits: painted clothes look skin-tight (no loose kurta/hoodie shapes); the free bodies are the athletic "Superhero" build only; not tested on a phone (14k-triangle skinned players should be fine for 8 players, unmeasured).
- On your own scooter the 3D person stands with both arms reaching to the handlebar (bones turned on top of the idle clip); on a friend's two-wheeler/auto they sit in the driving pose.
- **Street people up close** (added same day): the nearest walkers within 28 m become full 3D people (pool of 4 on Medium, 8 on High, none on Low), with the same colours as their crowd version (build/hair may differ — small "pop" when they switch); they idle when they wait for you. Farther walkers stay the light instanced crowd.

## Enterable buildings (2026-11-13) — owner: "make the apartments and buildings so that people can go inside"

- **Every building has a front door** (1,819 in the test area): on the wall facing the nearest street (`packages/worldgen/src/buildings/doors.ts`), drawn on the facade (wooden door for homes/temples, wide glass door for shops). Walk up to it → **Go inside** button (or E). Inside, at the doormat → **Go outside**.
- **The inside is its own room** (like most open-world games): built on the device from the building's kind and size (`apps/web/src/world/interiors.ts`), placed 60–100 m under the building (different depth per building, so neighbours never overlap). Same door → same room for everyone, so **friends see each other inside**; people inside are hidden from people outside and the other way round. Nothing changed in the network protocol or server (the server only limits sideways speed).
- 13 layouts: home/flat (shoe rack, living room with sofa/TV/rug, kitchen, dining table, bedroom behind a partition, a small prayer shelf), supermarket (checkouts, aisles of products with a centre aisle, fridges, section boards), mall (shop fronts, fountain, benches, plants, kiosk, skylight), car showroom (3 real CC0 Kenney cars on stands), school/college classroom (desks + benches, blackboard, fans), office (reception, desks with monitors, water cooler), restaurant/café/bakery, shop (wall shelves, counter), place of worship (carpet, platform, plain golden arch — no deity art), hotel lobby, clinic, gym, warehouse. Sizes follow the footprint, clamped per kind.
- One merged mesh per room with **baked lighting** (MeshBasic, no extra lights → no shader rebuild); walls/floor/furniture are solid physics boxes; the city, traffic and people are not drawn while inside (cheaper). Indoors the sun is turned down and the sky light up.
- Honest limits: every flat in a tower is the same single flat (no lifts/stairs/floors yet); doors are a guess (the map rarely marks entrances); doors of buildings beyond the walkable edge (±500 m) cannot be reached; no interactive furniture yet (sit, buy, open fridge); not tested on a phone.

## Characters, round 2 (2026-11-13)

- Blinking (new eyelid bone, every 2.5–6 s, sometimes twice), slow look-around when standing, hip and chest sway when walking; kurta reshaped (legs no longer poke through).
- Honest: code-built characters are near their limit. A real AAA look needs sculpted/scanned models and motion-captured animation — see BUGS/next steps for the options (all must be CC0/CC-BY or ours).

## More detailed characters (2026-11-13)

- Players (full detail, ≈ 8,600 triangles, was ≈ 3,000): shaped torso and hips (lathe profiles), tapered thighs/upper arms, knees and elbows, **soft bending** (vertices near shoulders, elbows, hips and knees shared with the parent bone), hands with four fingers and a thumb, face with jaw/chin, irises, pupils, eye highlights, upper lids, nose with nostrils, lips, ears; clothing details (tee collar + hem, hoodie drawstrings + hood + waistband, kurta buttons + band collar + hem border, jacket front edges + pocket flaps + shirt buttons), belt + buckle, back pockets, jeans seams + hems, sneaker laces + side stripe + heel tab, a watch; rounded long hair and fringe; soft baked shade on down-facing surfaces; MeshStandardMaterial (roughness 0.68).
- Street crowds keep the light model (≈ 450 triangles, Lambert) — unchanged cost.
- Honest: still a stylised, built-in-code character, not a scanned/sculpted AAA human; no facial animation or blinking yet; checked on a laptop only.

## Speedometer + gated societies (2026-11-13)

- **Speedometer**: round km/h dial at the bottom centre whenever you ride or drive (any vehicle); arc fills to the vehicle's top speed, turns red above 85 %, shows "R" when reversing. Updated 10×/s.
- **Gated societies** (`packages/worldgen/src/pack/compounds.ts`, mesh in `buildings/compoundMesh.ts`): every named `landuse=residential` area of 1,500 m²–60 ha with ≥ 2 buildings inside gets a 2.1 m plastered compound wall with a grey coping along its outline, in ≤ 6 m pieces that follow the ground. Openings wherever a road (road width + 2.4 m) or path (2.2 m) crosses. The widest road in gets the **entrance gate**: two pillars, an arch 4.4–5.9 m high with the society's **real name** on its front, a security cabin inside and a raised (open) boom barrier. Walls and gates are in the chunk building mesh → solid. Walls are left out of far (LOD1) chunks; gates stay.
- Rules: no road in → no wall (nobody gets trapped); wall pieces inside a building or on top of a neighbour's wall are skipped; edges cut by the world border get no wall or gate; nothing within the gate opening.
- Test area: 18 walled societies (Assetz East Point, Adarsh Palm Retreat Villas/Mayflower/Jacaranda/Daffodils/Hibiscus/Mayberry, Krishvi Dhavala, Prestige Summer Fields, Saroj Whitesands …). Towers inside are the real mapped blocks (Assetz A1–C4, Tower-01…04) with their names on signs. Verified in the browser at the Assetz gate.
- Nearby places asked for by the owner are all inside the default 1.2 km area with signs: Mango Hypermarket, Shakti 80 Trees (OSM name; "Suryashakti" not in the map), Kumari Amaranthine Apartment, Krishvi Dhavala (+ Phase-II), Sri Sai Ikon, Adarsh Palm Retreat (+ Villas, phases). **GEAR Innovative International School** is mapped only as a campus outline (OSM relation in two parts, `amenity=school`, no school building). The map query now also fetches named school/college/hospital/worship/marketplace outlines and named mall/supermarket sites (`campuses.ts`): one sign per name (largest part only); the name goes on the real non-home building nearest the campus middle that has no name of its own — or, if there is none, on a **generated** plain 3-storey block placed on free ground inside the outline (marked `guessed`, id ≥ 9e12). Campuses also get a compound wall + named gate. GEAR now sits next to Kumari Amaranthine and Shakti 80 Trees, as the owner described (test checks < 80 m). Long names shrink on the 4 m board (TODO: wider boards). PACK_VERSION 11.
- Honest limits: gate placement is a guess (widest road crossing the outline, not the mapped real gate — OSM rarely maps gates); boom barrier is always up; walls do not stop at mapped gates/barriers; PACK_VERSION now 11.

## Real names + Bengaluru architecture (2026-11-13) — owner: "yes real names with real architecture"

- **Real names on signs** (owner's decision, replaces the old "no shop signage" rule): real places show their OpenStreetMap `name:en`/`name` as plain text (≤ 40 characters, hidden characters removed) — never logos. Invented places keep made-up names; a test proves they never copy a real one. Named apartment buildings and places of worship are now places too.
- **Named housing complexes** (`landuse=residential` with a name, e.g. "Assetz East Point") get a free-standing gate board by the road (≤ 20 per area). The board has no posts yet (floats 2.2 m up) — TODO.
- Sign limit 120 per area (picture 512 × 2880). Priority: named real places and the three must-haves (mall, showroom, supermarket) first.
- **Architecture from the map**: `building:colour`, `roof:colour` (names or #hex) and `building:material` (glass → glass facade; brick/stone/concrete/metal/wood → wall colour) are used when tagged. **Honest: in the test area only 1 of 1,903 buildings has any of these tags.** Roof shapes (gabled/hipped/dome) are NOT built — Bengaluru data has 1 tagged roof.
- **Bengaluru typology instead** (applies everywhere): terrace parapet walls (0.9 m, both faces, no windows) on flat roofs of homes/flats/shops/civic; black plastic water tanks on a steel stand on terraces (1–3 per building by roof size; 1,440 in the test area; only the nearest 60 drawn).
- **Raise PACK_VERSION whenever pack rules change** (now 8): an unchanged version silently reuses old cached packs.

## Places + going together (2026-11-13)

- **Search**: `GET /api/search?q=` → OpenStreetMap Nominatim, server-side only, global queue (≥ 1.1 s between requests), identifying User-Agent (OSM_CONTACT in production), 30-day in-memory cache, results biased to Bengaluru (viewbox) and limited to India, duplicates of the same name within ~300 m merged, 10 searches/min per IP. Search runs only on Enter/Search (policy: no autocomplete).
- **Home**: optional "Pick a place" before "Start a Nukkad" (otherwise the test area).
- **In game**: **Places** button → search → **Go with everyone** → `{t:'travel'}` (2 burst, 4/min per connection) → server moves the room (old positions forgotten) and tells everyone → each client shows "X is taking everyone to …", reloads, and **re-joins by itself** (sessionStorage flag read once per page load; React dev mode runs effects twice — guarded).
- Verified: test area → VR Bengaluru (Whitefield, area a_12996_77695_600: 2,020 buildings, 53 real places, the real mall building found as `mall`, glass front). A brand-new area takes ~30–60 s (Overpass).
- Real place names appear only in search results and the travel message; signboards still show made-up names (owner's rule) — **open question to the owner**.
- B-005 hit again: every server restart (also `node --watch` in dev) loses rooms → "expired link". Rooms in MongoDB is now high priority.

## People walking (2026-11-13)

- 160 seeded walking routes per area on almost every street, 0.8 m beyond the road edge, either side, 1.1–1.6 m/s, same shared-clock trick as traffic (friends see the same people). They pause if you stand right in front.
- Light avatars (`buildAvatarGeometry(look, true)`, ≈ 420 triangles), 8 seeded looks = 8 instanced meshes; arms and legs swing in the vertex shader from the bone index already in the geometry (no skeletons). Not solid, no shadows.
- Drawn within 0.8 × the street-life radius (40 / 64 / 112 m).

## Live traffic (2026-11-13)

- `packages/worldgen/src/traffic/routes.ts`: 40 seeded routes per area on trunk/primary/secondary/tertiary roads (≥ 6 m), linked where roads share OSM points; each route ≤ 2.5 km, driven out and back, **on the left** (India). Mix: 38 % two-wheelers, 20 % autos, 14 % hatchbacks, 11 % sedans, 11 % SUVs, 6 % buses; 8.5–12 m/s by road.
- Position = route + **the room's shared server clock** (`remotes.clock.renderTime`), so friends see the same traffic with zero network cost (before joining, `Date.now()` is used).
- A vehicle waits when you are 0–9 m in front of it in its lane — **only on your screen** (it falls behind its timetable there; friends' copies keep going). The 5 nearest are solid (kinematic Rapier boxes).
- Parked vehicles moved off main roads (residential/living/service only) so they don't block lanes. Buses still wait at stops on main roads (traffic passes through them — TODO).
- Drawn within 1.5 × the street-life radius; one draw call per vehicle type.

## Drive any vehicle (2026-11-13)

- Walk within 3.5 m of a parked car / auto / two-wheeler / bus → **Drive …** button (or E / F key). **Get out** parks it where you left it (only on your screen; friends still see the original spot — TODO).
- `apps/web/src/game/vehicleSpecs.ts`: per-type top speed, acceleration, brakes, wheelbase (bicycle-model steering, less lock at speed), grip and handbrake grip (**Drift** button / Space), collision radius, driver visible or not, camera distance. Car ≈ 60–68 km/h, auto 43, two-wheeler 50, bus 43.
- While driving, your collision body is a round capsule of the vehicle's width (bumpers are not exact). Hitting a wall cuts speed by 40 %.
- Friends see the right vehicle: flags bits 4–7 carry a vehicle code (1 own scooter, 2 hatchback, 3 sedan, 4 SUV, 5 auto, 6 two-wheeler, 7 bus). **These bits were reserved for emotes** — emotes now need another byte when they are built.
- Measured: 0→40 km/h in 3 s, 59 km/h top after 6 s, FOV 62°→75°.

## Look overhaul (2026-11-13) — owner: "make it cooler, AAA"

- Owner chose "the most realistic options possible" + "cinematic on High only".
- **Photo-scanned CC0 textures** (Poly Haven, 3.1 MB, Medium/High only, `apps/web/src/world/surfaces.ts`): asphalt with a normal map on roads, painted plaster on walls, worn concrete on roofs, dry soil on the ground — laid in world space (no UVs needed) and normalised by each photo's average colour, so map colours are kept.
- **Film-style tone mapping** (ACES, exposure 1.15) on every level; the sky is excluded (`toneMapped: false`) or it washes out.
- **Glow pass on High** (UnrealBloom 0.22 / 0.4 / threshold 1.0, 4× MSAA half-float target). First try at 0.35/0.92 blew night windows into fog — window light is now 0.55 and offices light ~38 % of windows.
- **Cars now use Kenney's Car Kit (CC0, 2026-11-13)**: the owner could not download Sketchfab models, so Claude fetched Kenney's free kit (no account needed). Hatchback, sedan, sports sedan, SUV, luxury SUV — turned to face -z, scaled to real widths (1.7–1.88 m), two looks per type, own texture (`models/kenney/Textures/colormap.png` must sit next to the .glb files). Stylised, not photo-real. Autos, two-wheelers, buses, carts, stops stay code models (the kit has none). Bloom threshold raised to 1.25 so light cars don't glow.
- **Photo-real cars are still NOT available for free without an account**: Poly Haven has no cars, Kenney/Quaternius are stylised. The most realistic route is CC-BY Sketchfab models the owner downloads with their own account into `apps/web/public/models/<name>.glb` (names: hatchback, sedan, suv, auto, two_wheeler, bus, stall, bus_stop) — the loader already uses a .glb only when no code model exists, so that priority must be flipped when real files arrive.

## L3 — street life (2026-11-13)

- **Blender could not be used:** the MCP add-on never listened on port 9876, headless Blender crashes in Claude's sandbox (Metal GPU blocked), and the owner's paste of the Python one-liner did not work. The owner said to use something else. `tools/blender/build_assets.py` stays in the repo (builds the same 8 models in Blender) for later; any `public/models/<name>.glb` is only used for names that have no code model.
- **Models in code** (`apps/web/src/world/vehicleModels.ts`): hatchback, sedan, SUV (bodies cut from real side silhouettes with wheel arches, rounded edges, cabin narrowing above the belt line, tinted glass, head/tail lights, blank plates, mirrors, rims), green-and-yellow auto-rickshaw, two-wheeler, city bus in our own colours (no operator logos), fruit cart, bus shelter. ≈ 330–1,050 triangles each.
- **Glossy paint**: `MeshStandardMaterial` with a studio reflection map (RoomEnvironment) on vehicles only (on everything it washed the world out). `aPaint` per vertex: 0 matte, 1 paint (per-car colour, roughness 0.28, metalness 0.35), 2 glass/lights (roughness 0.12). Reflections dim at night.
- **Placement** (`packages/worldgen/src/props/streetLife.ts`): kerbside parking on residential/tertiary/service streets (42 % two-wheelers, 18 % hatchbacks, 12 % sedans, 12 % SUVs, 16 % autos), skipping junctions and buildings; bus stops every ~320 m on main roads with a waiting bus at 40 %; fruit/food carts in front of 60 % of food/grocery/cafe places. Test area: ≈ 600+ vehicles, 12 carts, 4 stops.
- **Only near things exist on screen**: nearest ≤ 90 per kind within 50 / 80 / 140 m (Low/Medium/High), refreshed every 8 m; ≤ 24 per kind cast shadows (shadow-only copies); the ones within 30 m are solid (Rapier boxes) — never before their model is drawn.
- Measured (laptop, Medium, a busy street): 71 draw calls, 164k triangles with shadows — a bit over the 150k Medium budget; trim `MAX_SHOWN` or the radius if the phone struggles.

## L2 — graphics (2026-11-12)

- **Sun shadows** on Medium (1024 px, ±35 m around you) and High (2048 px, ±70 m); Low keeps the blob shadow. The shadow area follows you, snapped to whole shadow pixels so edges don't crawl. Light comes from the sun by day and the moon at night (lifted to ≥ 14° so shadows never stretch forever).
- Only trees near you cast shadows: invisible copies (≤ 250 per tree type, refreshed every 10 m) on layer 1, which only the sun's shadow pass draws. Without this, tree shadows cost 54k triangles.
- **Facades** (`apps/web/src/world/materials.ts`): style per building from what it is used for (place) or its map type — house, apartments (slab edges), glass office/mall, shopfront with shutters on the ground floor, school/civic colour band, industrial strip windows; glass lighter at the top (sky reflection); grime near the ground. Offices have more lit windows at night.
- **Roads**: dashed centre line on car roads ≥ 5.5 m, edge lines on roads ≥ 8.8 m, light kerb strip, asphalt grit noise. Paths have no markings.
- **Ground**: soft blotches + grain (noise in the shader, no textures). **Water**: moving ripples + sun glint (none at night). **Trees**: darker below, lighter on top, gentle sway in the wind.
- Pack format v5 (`building.use` = place kind, used for the facade).
- Measured on the laptop at street level: Medium 32 draw calls / 118k triangles with shadows; High 30 / 117k. Phone fps still unknown.

## L1 — places (2026-11-12)

- The map query now also asks for point shops / food / pharmacies / banks / schools / offices / hotels / gyms (kind only — names, brands and operators are never used).
- `packages/worldgen/src/pack/places.ts` picks up to 100 places per area: real ones first (building tags + points), then invented ones: one mall, one vehicle showroom and one supermarket if the map has none, offices and shops in commercial/retail buildings, ground-floor shops along busy streets (45 % of small buildings there, 6 % on quiet streets).
- Test area: 98 signs, 30 real (8 schools, 4 colleges, supermarket, bank, pharmacies, eateries…), 68 invented (incl. the mall and the showroom). Pack 67 KB.
- Names come from `placeName(kind, seed)` in `packages/shared/src/places.ts` (e.g. "Lakeside Supermarket", "Banyan Darshini"). A test proves no real name from the map appears in the pack or on a sign.
- Signs: one canvas picture (512 × 2400, ≈ 4.7 MB GPU) + one merged mesh = 1 draw call; unlit, so they glow at night.
- Pack format v4.

## Phase 5 — what was built

- **Sun** (`packages/shared/src/geo/sun.ts`): position from lat/lng + UTC (almanac formulas, ≈ 1°). Tested: peaks ≈ 60° over Bengaluru at ≈ 12:05 IST on 10 Nov; below the horizon at midnight; rises in the east.
- **Sky** (`apps/web/src/atmosphere/sky.ts`): shader dome following the camera — horizon-to-top gradient, sun disc + glow, moon disc, stars when properly dark. One draw call, no textures.
- **Atmosphere** (`apps/web/src/atmosphere/atmosphere.ts`): six looks from deep night to full day blended by sun elevation (sky colours, fog colour = horizon, sun/moon light colour + strength, ambient). Moon light comes from roughly opposite the sun. Uses the place's **real local time** (time zone from the Area Pack), recalculated twice a second. `night` 0→1 between +2° and −6° sun elevation.
- **Night lights**: ≈ 40 % of windows glow warm (chosen per window, same for everyone), street lamp heads glow, soft pools of light on the ground under every lamp (one extra draw call, only at night). No real light sources (too slow on phones).
- **Debug**: overlay shows the local clock + night value; a **Time slider** (0–24 h) previews any hour, "real" goes back to now.
- Not done: weather (an Extra), facade variety (an Extra), sun shadow maps (blob shadows only), photo-mode time slider (Phase 6).

## Scooter (pulled forward from Phase 7, 2026-11-12)

- **Ride / Walk** button (bottom right) or the R key. Everyone has their own scooter (built in code, ≈ 500 triangles, accent = your outfit colour).
- Arcade handling in `apps/web/src/game/localPlayer.ts`: 0→5 m/s in 1.5 s, top 9 m/s (≈ 32 km/h), brake 9 m/s², slow reverse 2 m/s, steering weaker at speed, a little slide (grip 9/s), slows down hard when it bumps into a wall. Same collision body as walking, so kerbs and walls still work.
- Lean into turns (up to 0.38 rad), camera swings in behind you while riding (not for 1.5 s after you drag the view), and the FOV kick: 62° → 76° at top speed, camera pulls back 1.3 m.
- Network: the riding flag is sent; others see the scooter and the ride pose, and their lean is worked out from how fast the rider turns.
- Not done: wheels do not spin, no engine sound, the hands only roughly reach the handlebar.

## Phase 4 — what was built

- **Protocol** (`packages/shared/src/protocol`): 13-byte binary state, 6 + 11-bytes-per-player snapshots (94 bytes for 8), validated JSON for join / look / ping / leave and welcome / joined / left / look / pong / error. Name cleaning (1–16 characters, no control/invisible characters).
- **Rooms** (`apps/server/src/realtime/rooms.ts`): 12-character random ids (≈ 62 bits), max 8, reconnect token (24 chars, kept in the tab's sessionStorage) gets your slot back for 60 s, "away" after 10 s of silence (set only by the server), slot freed after 60 s, empty room kept 24 h. Movement checks: inside ±640 m and ≤ 25 m/s since the last accepted update (+3 m slack).
- **Hub** (`apps/server/src/realtime/hub.ts`): WebSocket on `/ws`, origin check, 2 KB message cap, per-connection token buckets (states 20/s with a 60 burst for catch-up after stalls; JSON 10/s), connection closed after 300 dropped messages, joins limited per IP (20 burst, 10/min), 15 Hz snapshots, skips snapshots for a slow phone (> 64 KB buffered).
- **REST**: `POST /api/rooms {lat,lng}` (5 burst, 2/min per IP) · `GET /api/rooms/:id`. No room list exists.
- **Client** (`apps/web/src/net`): reconnect 0.5→8 s; clock sync from the fastest snapshot; others drawn ≈ 133 ms in the past, up to 400 ms when jittery; 250 ms extrapolation then stop; glide, teleport only if > 8 m off; faded avatar + "reconnecting…" tag when away. Leaving the page sends `leave` (slot freed at once).
- **Screens** (`apps/web/src/ui/Root.tsx`): home (name → Start a Nukkad; spot = `?lat=&lng=` or the test area), invite page `/r/<id>` (name → Join), friendly "expired/wrong link" and "full" screens. In-game: players count, **Invite friends** (share sheet or copy), Your look.
- **Avatars, detailed** (`apps/web/src/player/avatar`): 11 bones (knees, elbows), rounded body, sneakers, face (eyes, pupils, eyebrows, nose, ears, mouth), hair shapes (short, long, bun, curly, cap, none), outfit details (tee print, hoodie hood + pocket + strings, long kurta, open jacket with collar). ≈ 3,000 triangles, still one draw call per player. Ride pose ready for the scooter.
- **Stress test** (`npm run stress`): 8 bots with lag 50–400 ms and loss 0–10 % (as TCP resend stalls), result 14.4–15.2 snapshots/s each, worst gap 346–664 ms, all saw 8 players, 9th turned away, 0 false rejections, CPU 5–7 %, 128 MB (server + bots in one process).
- **Two-tab check**: Sam saw Ria walk at a steady 5 m/s with no jumps (largest step 0.14 m per frame), drawn 135 ms behind.

### Phase 4 — not done / honest limits

- **Rooms live in server memory only.** A server restart loses the rooms (links stop working). PLAN wanted MongoDB for rooms — TODO before deploy.
- **Emotes**: only the protocol bits exist (flags 4–7). No UI — they are an "Extra" at the end of Day 4.
- **Host lock / remove** (Question 5): not built yet (priority just above weather).
- **Production routing**: `/r/<id>` links need a "rewrite everything to index.html" rule on Vercel — add with the deploy.
- Real devices on different networks: not tested by me.

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

1. Phase 5 — atmosphere: real local time sun/moon, sky, fog, street lights + window glow at night → STOP 3.
2. Owner: phone report (5 taps on the logo → Copy report) + phone model.
