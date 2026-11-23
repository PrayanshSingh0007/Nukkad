# Nukkad — NOTES

Read order for a fresh session: PLAN.md → this file → BUGS.md.

## Current status (2026-11-13)

- **Owner's goal now (2026-11-13): "a Bengaluru open-world game like GTA" — an original game in that style, friendly, NO violence** (owner picked "Friendly, no violence"). Must-haves in their words: real Bengaluru apartments, schools, malls (e.g. "VR Bengaluru") where friends gather and go together; **drive any vehicle**; **live traffic & people**.
- Order: drive any vehicle (DONE) → live traffic (DONE) → people walking (DONE) → people walking → place search + "Take everyone there" → real place names (needs the owner's OK: it bends their own "no shop signage" rule — names would be map labels/plain boards, never logos).
- Never copy GTA's name, characters, art or missions (Claude's rule: genre yes, recreation no).
- `npm test` 122 green. Phone fps still unknown.

## START HERE: hand-over for any model (2026-11-17)

The owner can no longer use the model that did most of this work, so this section is written for whoever continues. Keep working the same way: small steps, check in the real game, commit and push after each piece.

**How to test in the game (important, saves hours):**
- Start the dev server with the preview tool (`nukkad-dev-http` in `.claude/launch.json`), open the page, click "Start a Nukkad". `window.nukkad` is the Game.
- The preview pane throttles frames. Stop the loop and drive frames yourself: `nukkad.view3d.renderer.setAnimationLoop(null); nukkad.governor.frame = () => 'ok';` then call `nukkad.frame(performance.now())` in a loop with ~34 ms waits. Render 2–3 times before a screenshot; the first is often stale.
- Useful handles: `nukkad.debug.player` (`body.teleport(x, y, z)`, `heading`, `rideSpeed`), `nukkad.streetLife.kinds` (parked vehicles; each has `items`, `mesh`, `textured.path`), `nukkad.toggleDrive()`, `nukkad.debug.rig.camera`, `nukkad.traffic.lanes`.
- To check which way a car model faces: place a copy with `makeRotationY(Math.PI / 2)` (its front then points to −x) and look from the −x side. If you see the rear, add `back: true` in `CARS`.
- Keys: dispatch `KeyboardEvent('keydown', { code: 'KeyW' })` on `window` to drive.

**Next steps, in the order the owner cares about:**
1. **BMW M5 F90 and M4 CSL** are downloaded but not in the game: they are too heavy (250k and 84k triangles after `slim.mjs`). Open Blender (the MCP add-on listens on 9876), import, add a Decimate modifier per mesh to reach about 20k triangles, export GLB, then run `tools/vehicles/slim.mjs`. The originals were in the session's temp folder and are gone; re-download from Sketchfab (owner must be signed in and must approve): M5 `5478e978bd634337adc8e3dc413fbfa3` (Res1n), M4 CSL `26d05968e63b4fc28205cbb9abb0ea41` (BlackSnow02). Remove badges (materials named logo/badge) and credit them in CREDITS.md.
2. **Phone test.** Nothing since the bigger map (now the owner's 2.7 km square), the Indian cars or the speed changes has been tried on a phone. The owner copies a report with 5 taps on the logo. If it is too slow: lower traffic, lower `NEAR_FULL`, or lower traffic counts in `world.worker.ts`.
3. **Fortuner, Innova, Swift, Scorpio:** no clean free models exist (see "Indian car models" below). Do not use BHP3D or other game rips.
4. **Speed feel extras** the owner would like: skid marks, tyre smoke, real motion blur.
5. **Roads:** lane markings on flyover decks; smoother junctions.

## Realistic riders on the nearest traffic two-wheelers (2026-11-23)

- **`TrafficRiders`** (`world/trafficRiders.ts`): the nearest traffic scooters and motorbikes within 18 m get a Rocketbox person instead of the light rider figure. They sit on the seat with hands on the grips and feet on the pegs (IK, the same seat, grip and peg points your own riding uses), wear a seeded helmet, and have seeded clothes. How many: a quarter of the quality's near-people budget (High 2, Medium 1, Low 0). `TrafficView` picks them from last frame's nearest vehicles (`lastNear`), and skips the light rider for those vehicles.
- **Helmet reshaped into a full-face helmet**: the shell now comes down round the jaw, with a black rubber trim at the edge, a dark visor from forehead to mouth and a chin bar. On Rocketbox people it now tilts with the head (leaning over the bars, looking round), using the head bone's own axes (+x up through the skull, +y out of the face). The light figures use the same shape.
- Checked in game: a realistic woman on a traffic scooter (feet on the deck at 0.26 m), your own character's helmet on your scooter, and a light rider's helmet on a motorbike.
- Not checked: a motorbike with a realistic rider (only scooters came close in the test), and how it looks at speed from your own camera while riding past.

## Helmets on two-wheeler riders (2026-11-23)

- **Helmet** (`player/avatar/helmet.ts`): a rounded shell (a little longer front to back) with a dark visor across the face. Eight seeded colours, mostly black and white, some red, blue, silver or yellow.
- **Traffic riders** (`TrafficDrivers`): every two-wheeler rider (scooters, motorbikes) wears one, placed with the same lean about the waist the pose shader uses (head 1.64 m on the light figure). One extra draw call. Car, bus, truck and auto drivers don't.
- **Your character**: puts one on while riding your own scooter or any leaning vehicle (`Motion.helmet` from `LocalPlayer`). It follows the head bone (`RocketboxPerson.setHelmet`). The colour is seeded from your look. Classic bodies don't get one.
- Remote players don't show helmets yet (their motion doesn't say what they ride).
- Checked: your character on the scooter, and a traffic scooter rider.

## Realistic people at bus stops and carts up close (2026-11-23)

- **`WaitingPeople` now swaps in Rocketbox people up close**: every placement (bench sitter, stander, cart customer) is recorded with its light-figure instance. Twice a second the nearest few within 22 m (half the quality's near-people budget: High 4, Medium 2, Low none) become realistic people, and their light figure is hidden (instance scaled to 0).
  - Sitters use the sit clip on the bench. Standers wait (idle), or chat (talk clip) two in five of the time; in rain they keep their umbrella up instead.
  - Each gets a seeded person, top colour and umbrella. The person is spread by list position, because the first try gave three copies of the same man at one stop.
  - Checked: a woman standing, a woman beside her and a man on the bench at a shelter.

## Photo mode depth of field, pigeons on the ground (2026-11-23)

- **Depth of field in photo mode** (three.js `BokehPass`, High only): focus follows the distance from the camera to your chest. Things nearer or further go softly out of focus (aperture 0.00035, max blur 0.009).
  - It is inserted before the cinema pass only while photo mode is on with "Depth blur" pressed (on by default; the button shows only when the High chain exists). It is removed when you leave, so it costs nothing in normal play.
  - Checked: background buildings and the near ground soft, you sharp; off, everything sharp.
- **Pigeons on the ground** (`PerchedBirds`, `ground` flags): at about half of the carts and bus stops, 3–7 birds (mostly pigeons, the odd crow or myna) peck about 3 m away. Their heads bob down now and then and they turn a little. 128 in the owner's square.
  - They take off like the wire birds when you come close: wingbeat sound, back after a minute.
  - They are lifted 0.2 m (at 0.12 m they sank into raised dirt patches).
  - Checked: pecking pigeons by a cart, gone after you walk up (6 flew).
- Ground pigeons are made in `addCables`, so a map with no cables would have none (none known).

## Traffic you can hear: honks and pass-bys (2026-11-23)

- **Honks at you** (`TrafficView` `lane.blocked`, `takeSounds`): a vehicle held up by you standing in front of it honks after 1.4 s, then every 2.6 s. Buses and trucks sound deep, autos and two-wheelers high and thin, cars in between; one long blast or two short ones. Panned by where it is and quieter further off (`Sound.hornAt`).
- **Pass-bys** (`Sound.whoosh`): the moment a vehicle going over 6 m/s that came within 9 m of you starts to move away, a rush of air and tyre noise falls in pitch (Doppler-ish) and swings across.
- Panned relative to the camera (its right vector); nothing indoors.
- Checked that the events fire: 4 honks in about 10 s standing in front of traffic; 5 pass-bys in about 13 s at the roadside. **Not listened to.**

## Shop light on the pavement at night (2026-11-23)

- **Shop light pools** (`Signs.pools`): in front of every signboard (shops, schools, offices), a soft pool of cool-white light on the ground at night. It is a little wider than the board, reaches about 4.5 m out, and fades to nothing outwards and to the sides (a fall-off picture drawn per pixel).
  - Stronger when the ground is wet (`setNight(night, wet)`). One extra draw call.
  - The first version had hard side edges (a radial gradient that didn't reach zero at the sides).
  - Checked in front of a lit building at 21:00.

## Falling leaves and petals (2026-11-23)

- **Falling leaves** (`world/fallingLeaves.ts`): up to 260 at a time drift down from the drawn trees within about 38 m (looked up once a second; palms drop nothing). One draw call of points.
  - Colours: green-gold from rain trees, ashoka and neem; orange-red petals from gulmohar; pink from tabebuia; magenta from bougainvillea.
  - Each tumbles (a spinning, squashed ellipse) and sways down on the breeze. Gusts let more go; storms bring more, faster and further.
  - They lie on the ground about 5 s, fade over 2 s, then start again from another tree.
  - Point size is capped at 18 px, because one close to the camera was a big blob.
  - Checked under a gulmohar: petals in the air and on the pavement.

## Friends walking together, chai cart crowds, speed check (2026-11-23)

- **Friends walking together** (`PedestrianView`): about one walker in five has a companion 0.68 m to their left or right on the same route (160 in the owner's square). Each is a different person or look, and they stay in or go out together.
  - Up close they turn to talk to each other now and then. Looking at you, or at a horn, comes first.
  - `poseOf` gives a walker's place with the side step. Look capacities are counted from the walkers, not the routes.
  - Checked: two women walking side by side, and another pair behind them.
- **Chai cart crowds** (`WaitingPeople`, now also given `WorldView.carts`): 2–4 people standing round each steaming cart, facing it. 92 posed people in all with the bus stops.
  - Checked: a customer by a steaming cart (the rest of the ring was hidden by the wall from that angle).
- **Speed check** (owner's Mac, preview pane, 1536 × 1152 on High, at the busy junction):
  - A full frame (with `gl.finish`) is about 6.8 ms by day and 6.9 ms on a rainy night (p90 7.4); on Medium 4.4 ms, on Low 4.1 ms (1024 × 768).
  - CPU: traffic about 0.2 ms, walkers about 0.2 ms, everything else under 0.1 ms. Drawing is about 5.5 ms of it.
  - Nothing needed optimising. A phone is still unmeasured.

## Wall posters, cooker whistles, wing flutter, footsteps (2026-11-23)

- **Posters on compound walls** (`world/wallPosters.ts`; spots from `houseCompounds` → `props.posters`, carried by the worker): about 45 % of front walls carry 1–3 posters on the street side. 1,808 in the owner's square, one draw call.
  - 16 invented designs drawn into one canvas atlas: tuition classes, house for rent and a missing cat (with Kannada), yoga and dance classes, a made-up film ("ನಮ್ಮ ಊರು"), sale, live music, computer classes, blood donation, a cricket tournament, spoken English, water tanker, an old sun-bleached one, and a stencilled "Stick no bills" and a hand-painted tailor's sign straight on the plaster.
  - No brands, real names or real numbers (phone numbers are "9xxxx xxxxx").
  - Weathered in the shader: torn ragged edges, peeled patches on the oldest, sun-fading and grime; pasted ones are tilted a little.
  - Checked: two posters on a wall.
- **Sounds** (`audio/sound.ts`, all made in code):
  - Pressure-cooker whistles from nearby kitchens at breakfast (6:30–9:30) and dinner (18:30–21:00), every 6–24 s.
  - A burst of wingbeats when birds take off from the wires near you (`PerchedBirds.update` now returns how many flew; `WorldView.updateNear` passes it on).
  - Footsteps: a soft tap on dry ground, a splash when wet.
  - `ambience` takes the game hour.
  - Checked that they all run without errors; **nobody has listened to them yet.**

## Sun glare on wet roads, painted tree trunks (2026-11-23) — owner: "keep making it AAA … for hours"

- **Sun glare on wet roads** (`WET_GLSL`, new `uSunDir` = the true sun direction, set by `WorldView.setSunDir`; the light direction is lifted at low sun so it can't be used): the sun mirrored in wet ground. A hard glint in puddles and a broad sheen on damp tar, blinding when you look into a low sun across a wet street; a faint cold glint from the moon at night. Weaker while it still rains.
  - Cache keys: roads-7, ground-7.
  - Checked at 17:33 just after rain: a golden glare on the road with your character silhouetted; none on the same road dry.
- **Wet streaks from far lamps** were long thin glowing poles from a low camera. Now they are shorter (reach 0.6 + 0.12 × distance), a little wider far off, and dimmer (down to 35 % beyond about 45 m).
- **Whitewashed tree trunks** (`wind` in `materials.ts`, `nukkad-wind-4`): bark-coloured parts below 1.1 m are painted white with a red band (0.76–0.92 m) and a ragged top edge, as roadside trees in India are.
  - Checked on a roadside tree.
- The camera already widened at speed (`BASE_FOV + ease × 20`), so nothing was added there.

## Endless skyline, aeroplanes, people at bus stops (2026-11-23) — owner: "more AAA"

- **The city goes on past the map** (sky shader): a skyline on the horizon, drawn on the sky dome so it is always beyond real buildings.
  - Low rooftops of uneven height all round; clusters of towers where a noise pattern says so (up to about 2° tall); red warning lights blinking on the tallest towers.
  - By day it is a faint layer in the haze. At night the towers go dark with lit windows in rows (about 10 % in the low sprawl, 30 % in the towers, mostly warm, some cool), against the city glow.
  - The first night version was one flat strip of glitter, so fewer windows are lit now and the rooftops are more broken.
  - Checked from 45 m up, day and night.
- **Aeroplanes** (sky shader): one chance every 140 s, about two in three happen. A plane crosses the sky in 90 s at 35–65° up. By day it is a dark speck with a white contrail spreading behind it; at night a white strobe plus red and green wingtip lights. None in heavy rain.
  - Checked by day: the speck is visible; the contrail only shows where it crosses blue sky (over white cloud it disappears).
- **People at bus stops** (`world/waitingPeople.ts`): 1–4 at each shelter (78 in the owner's square). Some sit on the bench, some stand at the front facing the road, a few are turned to look along it for their bus, swaying a little.
  - They are the light crowd figures, posed on the GPU like the traffic drivers, so they look plainer than the realistic people up close.
  - They cast no shadow, because the shadow pass would draw them standing.
  - Checked: one standing and two sitting at a shelter.
- **Last round's checks:** the bigger festive bulbs read well along a wall; at least one home window showed the cool TV glow among warm ones.
- **Not checked:** a phone.

## Steaming carts, birds on the wires, rooftop washing (2026-11-23) — owner: "more AAA"

- **Steaming carts** (`world/stallSteam.ts`): about four street carts in ten have a steel pot on the counter (boiled peanuts, corn, chai) with soft wisps of steam rising, swelling and drifting. A few have blue-grey frying smoke instead.
  - All on the graphics card: one draw call of points, plus one for the pots. Lit by daylight, and warm from the cart's bulb at night.
  - First tries: steam rose straight off fruit with no pot; then the pot sat inside the counter; then it rendered black (fully metallic with nothing to reflect). Fixed: pot on the counter, steel grey.
  - Only 5 carts in the owner's square have one, since there are few carts.
- **Birds on the wires** (`world/perchedBirds.ts`, perches worked out in `WorldView.addCables`): about half the cable spans have 1–5 birds on the top wire (crows, pigeons, mynas), facing either way. 989 perches in the owner's square; only those within 70 m are drawn.
  - They fly off when you come within about 6 m on foot. In a vehicle that grows with speed (up to 16 m), and a horn scares them at 18 m.
  - They flap up and away for 4 s, come back after about 60 s once you are 25 m away, and sit out heavy rain and the night.
  - The first sitting bird looked like a black box from below; it was reshaped (longer body, tail, beak).
  - Checked: two crows on a wire, then taking off as you came close.
- **Rooftop washing** (`world/rooftopLaundry.ts`): about a third of the terraces with a water tank have a washing line 1.7 m up, 2.4 m beside the tank. It holds 4–6 things (shirts, towels, now and then a long sari) in everyday colours, with folds and a darker damp hem.
  - It swings in the breeze, whips about in storms, and is taken in when it rains.
  - Only lines within 120 m whose building is on screen are drawn (`setRoofReady`, like the water tanks).
  - 1,159 lines in the owner's square; up to 900 pieces drawn.
  - Checked: a line by a tank. It was first strung too close to the tank, and moved out.
- **Not checked:** a phone; the TV glow and the bigger festive bulbs from last round, on screen.

## Turn signals, TV glow, festive lights, footstep splashes, pinch zoom (2026-11-23) — owner: "more AAA"

- **Turn signals** (`TrafficView`): a vehicle within 90 m whose road bends more than about 30° in the next 12 m blinks amber at the front and back on that side, about 1.5 times a second (one more points draw call).
  - Seen in the data: 2 blinkers while a vehicle turned.
- **TV light** (facade shader, `nukkad-facades-11`, which now gets the time): about one lit home window in seven has a television on. It gives a cool blue-white flicker that jumps in brightness and colour with each "cut" (about one a second).
- **Festive string lights** (`world/stringLights.ts`, data from `prepare.ts` → `props.stringLights`, carried by the worker): about one compound wall piece in nine has a string of bulbs on its coping, one every 30 cm.
  - The bulbs are red, green, amber and blue, chasing along the string, bright enough to bloom, at night only. One draw call of points.
  - 5,547 bulbs in the owner's square.
  - Checked at night: strings along walls. They were tiny specks at 11 m, so they were made bigger.
- **Footstep splashes** (`RainSplashes.splashAt`): on wet ground (wetness over 0.3), each step you take (one per 0.65 m) throws 2–4 splashes at the left or right foot.
  - Checked in the data: running on a wet road made splashes.
- **Photo mode pinch zoom** on phones (two fingers). Not tried on a phone.
- **`.claude/launch.json` was missing** on 2026-11-23: the `.claude` folder had been recreated empty. It's ignored by git, so it was rebuilt: `nukkad-dev-http` runs `npm run dev:http` on port 5173.
- **Not checked:** a phone.

## Drying roads, bougainvillea on walls, photo mode (2026-11-22) — owner: "more AAA"

- **Roads stay wet after the rain** (`game.ts` `wetness`, `materials.ts` `wet` / `uWet`, `WorldView.setRain(rain, wet)`).
  - Wetness soaks up within about 6 s of rain and dries over about 4 minutes once it stops.
  - The ground and walls follow wetness, not the rain: road film, puddles, darker soil and plaster, lights mirrored in the road, lamp pools, traffic spray and your own tyre spray and skid marks. Wet roads keep spraying after the rain.
  - It dries in stages: the glossy film goes first, then the puddles shrink to the deepest dips.
  - Drop rings in puddles, water dimples, storm wind and lamp light in the air still follow the falling rain.
  - Cache keys: roads-6, ground-6, facades-10.
  - Checked at three stages: raining, just after, nearly dry.
- **Bougainvillea over compound walls** (`prepare.ts`, `WALL_CREEPER_VARIANT` 3 in `scatter.ts`, `speciesOf`): about one wall piece in six (pieces of 3 m or more, seeded by the wall) gets a magenta bougainvillea bush spilling over the top, with fallen petals.
  - They join the trees, shuffled in, so the quality's tree limit thins everything evenly. On Low (no leafy trees) they are plain bushes.
  - In the owner's square that gives 1,024 bougainvillea of 3,486 trees, about half of them on walls. A first try at 1 in 3 gave 1,894, too many.
  - Kept inside the area (one landed 4 m outside and failed the pipeline test).
  - Checked: a bush on a wall corner and another down the street.
- **Photo mode** (P, or the new Photo button; Esc or Done to leave):
  - The HUD hides and cinema bars slide in. The mouse wheel pulls the camera from 1.6 to 18 m.
  - Looks (CSS filters on the picture): Natural, Golden, Monsoon, Noir.
  - "Save photo" renders a frame and downloads a PNG with the look baked in (`Game.takePhoto`).
  - Checked: bars, the bar of looks, and the HUD hiding and coming back. Saving wasn't tried, because it downloads a file.
- **Not checked:** a phone; photo mode with touch (there is no pinch zoom).

## Lightning bolts, brake lights, lamp insects, lens dirt, stars (2026-11-22) — owner: "more AAA"

- **Lightning bolts** (`atmosphere/lightningBolt.ts`): every storm flash now has a visible bolt, a jagged main channel plus 2–4 forks, from the cloud base (230 m) to the ground 220–520 m away, within about 45° of where you look.
  - Drawn as face-on ribbons, brighter than white so the bloom catches them: a core and a wide faint glow, additive. Buildings hide it.
  - It flickers with the flash. Thunder now comes after distance ÷ 343 m/s.
  - Checked: a forked bolt behind houses in a storm.
- **Brake lights** (`TrafficView`): a held-up vehicle (moving under 1.2 m/s on a route faster than 2.5 m/s, within 110 m) lights bright red brake lights, by day too. One more draw call of points.
  - Seen switching on in the data (2 lights while traffic queued), not caught in a screenshot.
- **Insects round lamps** (`world/lampInsects.ts`): on dry nights, up to 36 moths circle and dart under each of the 6 nearest lamp heads (looked up twice a second), lit warm, as soft round specks. None in rain.
  - Checked: a swarm in a lamp's light cone.
- **Lens dirt** (cinema pass): soft smudges and specks on the lens glow when the sun shines into it, brightest near the sun.
  - Checked facing a low sun, with the flare rings.
- **Stars:** now small soft dots placed within their cells (they were whole square cells), of different brightness, twinkling (more near the horizon).
  - Shooting stars: one chance every 17 s, about half of them happen: a short streak sliding down across a clear night sky.
  - Checked: a shooting star over a house.
- **Not checked:** a phone.

## Rainbows, people look at you, road dust, fruit bats (2026-11-22) — owner: "more AAAA"

- **Rainbow** (`sky.ts`, `uRainbow` set in `game.ts`): for about three minutes after rain (`recentRain` fades over 180 s), while the sun is up but under about 35°.
  - The main bow sits 40–42.5° from the point opposite the sun (violet inside, red outside). A faint second bow at 50–53.5° has its colours reversed, and the sky is a little brighter inside the main bow.
  - Weaker on cloudy days, none at night or while it still rains hard.
  - Checked: a double rainbow over the street at 16:18 after a shower.
- **People look at you** (`RocketboxPerson.lookAt`): the head (60 %) and neck (40 %) turn towards a point, up to about 65° to either side and a little up or down. A point behind them is ignored, and turns ease in and out.
  - The head and neck are put back to the clip's pose before each frame, so turns never add up.
  - Who looks where:
    - Street walkers glance at you within 6 m; startled walkers look at whoever honked.
    - Your character looks where the camera looks, on foot only (`Avatar.lookAt`). So when you swing the camera to the side, their head turns.
  - Checked: your character looking 64° to the side versus straight ahead.
- **Road dust** (`TrafficSpray` again): on dry days in daylight, faster traffic (over 9 m/s) leaves a faint warm-brown haze of road dust. In rain the same volumes are white spray.
  - Checked: a light haze behind a car, made a little stronger after.
- **Fruit bats** (`BirdsView`): at dusk, a loose stream of 18 flying foxes crosses the sky heading north-east, 38–78 m up, passing over you and wrapping round a 700 m stretch. Fewer later at night, none in heavy rain.
  - Checked at 17:57: specks against the purple dusk sky. At full night they're dark on dark and practically invisible, which is true to life.
- **Last round's unchecked items, now checked:**
  - Doorway eye adaptation: exposure 0.73 → 1.03 over a second going into a home; 1.95 → 1.39 coming back out into daylight, with visible glare.
  - The lake mirrors the late-afternoon sky.
  - Storm wind reaches the trees (`uRain` 1 in rain). Their motion itself isn't checked in a still frame.
- **Not checked:** a phone.

## Traffic spray, night city glow, eye adaptation, storm trees, sky-lit lakes (2026-11-22) — owner: "more aaa" (away 30 min)

- **Spray behind traffic** (`world/trafficSpray.ts`): on a wet road, every vehicle near you (within 70 m) that is really moving (over 5 m/s, measured from frame to frame) throws a mist of water up behind it, in one instanced draw call.
  - Each is a soft volume behind the bumper: a plume behind each wheel joining further back, densest low down, with wisps streaming back.
  - It grows with speed: 1.5 m plus 0.22 m per m/s (up to 25 m/s), and taller.
  - The first version was a smooth slab: invisible at normal strength, a white ghost when boosted.
  - Checked in rain behind a car at about 9 m/s.
- **City glow at night** (`atmosphere.ts`): the horizon and the lower sky take a warm sodium glow at night, much stronger under cloud and rain (the cloud base throws the street lights back). It warms the fog too.
  - Checked: a rainy night with a warm-lit cloud base.
- **Eye adaptation** (`game.ts` `adapt`):
  - Stepping out of a building into daylight starts at 2.1× exposure (glare). Going in from daylight starts at about 0.45× (the room looks dark).
  - Both ease back to normal over about 2 s. At night going out starts at 0.65×.
  - `BASE_EXPOSURE` (1.15) must match `scene.ts`.
  - Not checked in the browser.
- **Storm trees** (`materials.ts` `wind`): in rain, crowns sway about 3.4× harder, lean with slow gusts, and leaves flutter 3× more. Cache key `nukkad-wind-3`.
- **Lakes** (`materials.ts` `waterRipples`): mirror the real sky colours (they were fixed day colours, dimmed at night), and rain stipples the surface with fine dimples. Cache key `nukkad-water-3`.
  - Not checked on a lake in this pass.
- **Not checked:** a phone.

## Umbrellas, headlight light, wet people, morning mist, walk fix (2026-11-22) — owner: "more AAA"

- **Umbrellas** (`player/avatar/umbrella.ts`): an eight-panel canopy 1.06 m across, sagging between the ribs, on a shaft with a crook handle. Colours as on a Bengaluru street in the monsoon: mostly black, then navy, maroon and bottle green, and a few bright ones.
  - Realistic people (`RocketboxPerson.setUmbrella`) open theirs above rain 0.15 while standing or walking. It stays closed when riding, in the air, running or emoting. The right hand holds the handle by two-bone IK (grip at 71 % of their height, 17 cm to the right, 20 cm ahead), and the umbrella leans a little ahead and in over the head.
  - Players: everyone has one (colour seeded from the look, so others see the same).
  - Street walkers: about 4 in 5 carry one (seeded). The far crowd figures get instanced umbrellas (one draw call) at the same grip.
  - Known limit: rain streaks still fall under the umbrella.
- **Wet people:** clothes, skin and hair slowly darken (up to 24 %) and turn glossier (roughness down up to 45 %) in rain. They soak in about 10 s and dry over about 45 s, and stay much drier under an umbrella (30 %). `setPeopleLight` now takes the rain.
- **Headlight light in the air** (`world/headlightCones.ts`): a soft cone about 14 m long from each headlight at night, tipped 4° down. Faint when dry; strong in rain, with drops glinting through it, and in mist.
  - Traffic within 90 m uses one instanced draw call. Your own vehicle carries a pair (`CarLights`). The shader and geometry are shared, and `setHeadlightHaze` is called every frame.
  - Checked at night in rain: lit rain around oncoming headlights.
- **Morning mist** (`mistAt` in `atmosphere.ts`, tested): most mornings from about 5:15, thinning out by about 9:30, thicker on some days (seeded by the date).
  - It pales the horizon (so the fog, sky and reflections agree) and the sky a little, and softens the sun (−35 %) and fills the shade (+18 %).
  - It pulls the fog in: near up to 85 % closer, far up to 60 % closer. Rain now also brings fog in (far −30 %).
  - The quality's fog range goes through `Atmosphere.setFogRange`. Cloud shadows fade in mist.
  - Checked at 7:12: distant blocks fade into a pale haze.
- **Walk fix (BUGS B-032):** realistic people no longer glide ahead and snap back each step cycle. The clips' forward travel is removed at load, and their real speeds (for example, walk 1.13 m/s for a 1.73 m man) set the playback rate.
- **Not checked:** a phone.

## Cloud shadows, wet-road reflections, tyre spray, rain splashes (2026-11-22) — owner: "make it more AAA"

- **Cloud shadows** (`atmosphere/cloudShadows.ts`): soft patches of shade, 100–300 m across, drift over the whole city with the wind (about 6 m/s). They land on everything lit by the sun and come from the clock, so everyone sees the same ones.
  - How it works:
    - `installCloudShadows()` patches three.js's own lighting chunks once at start-up: `lights_pars_begin` gets a noise function and `lights_fragment_begin` dims the sun by the cloud pattern at that point.
    - Under a cloud, `lights_fragment_end` also dims 35 % of the sky fill. Without that, the strong fill light made the shadows almost invisible.
    - The settings live in one GLSL uniform, `nkCloud`, that three.js doesn't know about. `CloudShadows.update` writes it into every compiled program each frame, through `renderer.state.useProgram` so three.js's cached program stays right.
  - How much: about 0.72 of the sun under a cloud by day, none at night, indoors or on Low, and fading in rain. How much of the ground is shaded follows the real cloud cover (`atmosphere.cloud`).
  - Lessons:
    - A GLSL name in the patch must be unique across all shaders: `nkShade` already existed in `materials.ts` and broke one program.
    - The first pattern scale (260 m) was too big to see within one view.
  - Checked from above: half the view under a cloud with flat, cool light, the rest in sun. Cost not measurable on the owner's Mac.
- **Wet-road reflections** (`world/wetReflections.ts`): at night in the rain, street lamps and traffic's head and tail lights each leave a streak on the road.
  - Each streak centres where the light's mirror image meets the ground (closer to you the higher the light) and smears towards you. Its width is tapered so it stays even on screen; a fixed width fanned out into glowing cones.
  - One instanced draw call for the lamps, and one for traffic filled every frame (within 110 m).
  - Gate globes are left out: the method can't tell when a wall or truck hides a light, and their mirror images floated in front of walls.
  - The first version was far too bright and ran to the camera's feet, blowing out the bloom. Now it gives back about 28 % of the light.
- **Tyre spray** (`game/tyreFx.ts`): on a wet road above about 20 km/h, rising to full at 90, a thin mist of water is thrown up behind the tyres of the vehicle you drive and trails behind it. It reuses the smoke puffs (seed 1–2 marks spray, drawn at 0.17 opacity instead of 0.42), and `MAX_PUFFS` is now 420.
  - The first version looked like thick smoke.
  - Only checked with spray fed in at a set speed; a real fast drive in rain wasn't possible in the pane.
- **Rain splashes** (`RainSplashes` in `atmosphere/weather.ts`): up to 700 tiny crowns (a spreading ring and up to four droplets), each lasting about a third of a second, on the ground within 22 m of you. About 1,500 a second in a downpour, on the terrain height plus 12 cm so they show on roads.
- **Cost:** the rain additions together are about 0.5 ms a frame at night in a downpour (5.3 → 5.8 ms, 1536×1152, preview pane).
- **Not checked:** a phone.

## Dyed tops, film lighting for people, lamp light, birds (2026-11-21) — owner: "paint the clothing masks and make it more AAA"

- **Clothing masks** (`tools/characters/rocketbox-masks.mjs`, run on the avatar folder; writes `<name>_top.png` 512 px and `masks.json`):
  - The skin tone comes from the middle of the face texture.
  - The core of the top is the body triangles moved by spine, shoulder and arm bones, minus skin-coloured texels.
  - The top's colour range is then measured (chromaticity, with dark texels damped), outliers like tattoos are dropped, and the mask fills every connected texel of that fabric. It never spreads into hands, head or feet, or across the texture's empty background (that once reached a man's shoes). Separate pieces whose whole colour sits well inside the range are added, and islands under 160 texels are dropped.
  - Coverage is 20–36 % of each texture. To preview a mask, overlay it on the body texture; there is no script in the repo for that.
- **Dye shader** (`rocketbox.ts`): inside the mask, the top takes the new colour scaled by its own brightness over the top's average (`meanLum`), so folds, seams and prints stay. The colour is 18 % less saturated than the swatch.
  - New look field `tint`: 0 = their own top, 1–10 = `OUTFIT_COLORS`. The look panel shows a "Top" row for realistic people; the first, striped button is their own top.
  - Street walkers get a seeded top colour each (about a third wear their own).
  - Checked on all 8 people in game. Known miss: a red cuff on Male_Adult_06's sleeve keeps its colour.
- **People lighting:**
  - A rim of sky light around their outline (horizon colour, strongest on parts facing up, none indoors).
  - The city's sky reflections at 0.1–0.32 for a sheen.
  - Roughness: face 0.52, hair 0.6, clothes 0.78.
  - Fed every frame by `setPeopleLight` in `game.ts`.
- **Lamp light cones** (`world/lampBeams.ts`): one instanced draw call over every street lamp (1,500 in the owner's square). Each is an open cone from the head to the road, additive and never written to depth.
  - It fades at its outline, with height, and from 70 to 170 m. Fog is not used, because fog would add its own colour to added light.
  - Night only: 0.07 dry, up to 0.27 in heavy rain, with thin rain streaks falling through it at about 9 m/s.
  - The AO pass skips it (`isLine2` flag, the same rule it uses for lines).
  - Lesson: GLSL `pow()` of a value that interpolation pushed just below 0 gives NaN, and one NaN pixel turns the whole frame black through bloom. Clamp before `pow`.
- **Birds** (`world/birdsView.ts`): one draw call of up to 90, with the wings flapped on the GPU (two-part wings).
  - Black kites circle on seeded thermals (2 per ~260 m cell, 3 × 3 cells around you), 36–80 m up, banked and mostly gliding.
  - Three flocks (pigeons, crows, pigeons) loop 14–30 m up around a point that trails after you at 2.5 m/s, gliding together now and then.
  - They thin at dusk and in rain, and are gone at night. Checked in game: a pigeon flock overhead and a kite high up.
- **Not checked:** a phone; how the beams cost on a weak GPU when many lamps fill the screen.

## Drivers in traffic, jump, street reactions (2026-11-20)

- **The owner's two repos:**
  - `casanova77koresh/The-Pinnacle-Of-V` is gone (GitHub 404), and we had agreed earlier not to use it.
  - `gugu-2/Game-NPC-Brain-LLM` is a Python server: a fine-tuned Gemma-2 2B and XTTS voice cloning, with SQLite memory of players' chats. It can't run in a web game without a GPU server, and storing chats would break the "store only name, room, avatar" rule. We took its ideas (NPCs react to the live world and to the player) and built them without a language model.
- **Drivers** (`world/trafficDrivers.ts`):
  - Every moving vehicle has a seated person: the light crowd figure posed on the GPU (thighs, knees, shoulders, elbows, lean).
  - Seats: cars, buses, vans and trucks on the right (India is right-hand drive); two-wheelers centred and leaning; autos front-centre. Seat heights per kind.
  - 16 instanced draw calls in total. Checked: a scooter rider, and an SUV driver visible through the windscreen.
- **Traffic:**
  - Vehicles within 40 m use the full model; the light LOD looked crumpled up close.
  - Car-following: a vehicle waits while another is ahead in its lane going the same way, with a gap of both half-lengths plus 2.2 m. Measured: 0 overlaps among about 23 nearby vehicles over 16 s, with 16 of 22 moving more than 4 m in 2 s.
  - The waits happen on your screen only, like the existing wait for the player.
- **Jump:** Space on foot, about 0.6 m (it stays the handbrake in vehicles). `CharacterBody.jump` ignores ground contact for 0.12 s of take-off. Realistic people tuck their knees in the air; there is no jump clip.
- **Street reactions** (`PedestrianView.setWorld` / `honk`):
  - Fewer people are out in rain and late at night (seeded per walker, at least 22 %). Measured: 810 people dry, 324 in heavy rain.
  - Your horn makes people within 16 m stop, turn to face you and gesture (the talk clip) for 1.8 s.
- **Recolouring Rocketbox tops: done on 2026-11-21 with painted masks** (see the section above). Other clothes (jeans, skirts) keep their own colours.

## Realistic people: Microsoft Rocketbox (2026-11-20)

- The owner OK'd the download (about 340 MB from github.com/microsoft/Microsoft-Rocketbox, MIT): 8 avatars (Female_Adult_01, 03, 13, 17; Male_Adult_06, 08, 09, 16) and 16 clips (idle, walk, jog, sprint, sit, wave, dance, talk, for women and men).
- **Conversion** (Blender 5.2 via MCP):
  - FBX import needs a placeholder active object first, or the importer fails entering edit mode.
  - Materials rebuilt with relinked textures: body, head, and hair/lashes as a cut-out (alpha > 0.5, so glTF MASK). Textures shrunk to 1024 px WebP; normal and specular maps dropped.
  - Exported as GLB: 0.5–1.1 MB each, about 8.7k triangles, 80-bone "Bip01" skeleton, models face +z.
  - Clips exported one per file (merging actions in Blender 5 runs into action-slot trouble), then slimmed by `tools/characters/rocketbox-anims.mjs`: face and per-bone position tracks dropped, keys thinned. Walk went from 970 KB to 43 KB.
  - Everything in `public/models/people/rocketbox/` is 8.3 MB.
- **Game** (`player/avatar/rocketbox.ts`, `RocketboxPerson`):
  - Speed picks idle, walk, jog or sprint, with the clip speed matched so feet don't slide. Emotes are wave, dance, sit and talk.
  - Riding:
    - Seated vehicles use the sit clip with the hips lowered to 0.52 m (where every vehicle's seat values expect them, measured from the old people's drive clip). Feet and hands are placed with two-bone IK, and the upper back (Spine1) leans; in Bip01 the thighs hang off Spine, so Spine itself must not lean.
    - On the scooter, the hands reach the grips (0.88 m up, 0.4 m ahead) by IK.
  - Height is seeded: women around 1.62 m, men around 1.73 m.
- **Street walkers:** the nearest ones (up to the quality's limit) are Rocketbox people, each walker always the same one (route kind % 8); the far crowd is still the light instanced figures.
- **Players:** a new look field `person` (`PEOPLE` in shared: Classic, Asha, Meera, Priya, Divya, Arjun, Rahul, Kiran, Vikram). 1–8 picks a realistic person; 0 = Classic, the customisable body with outfits. Looks saved before this get a person matching their build. The look panel shows Person first; the other options only apply to Classic.
- **Checked in the browser:** a street walker; Asha standing and riding the Pulsar (seated, hands on the bars, feet on the pegs); Rahul on the scooter (hands on the grips).
- **Not done:**
  - Rocketbox people can't change clothes; only their top's colour can change (since 2026-11-21).
  - No jump clip: they stand when in the air.
  - The 3,000 far-off walkers are still the simple figures.
  - Not tested on a phone, or with many players at once.

## Street cables, shop glow, varied people; Rocketbox plan (2026-11-20)

- **Overhead cables** (`scatter.ts` `lampsAndCables`, `worldView.ts` `addCables`):
  - Three sagging wires (parabola, sag grows with span) run between neighbouring invented street poles on the same road, only where both poles survive the lamp cap. That is 710 spans in the owner's area.
  - One `LineSegments` draw call; GTAO skips lines.
- **Shopfronts** glow 2.4 × at night (homes 0.8 ×), bright enough for bloom.
- **People vary:**
  - Height: women around 1.62 m and men around 1.73 m, ±7 cm, seeded from the look so everyone sees the same person.
  - Build: girth 0.95–1.06.
  - Skirts and kurta skirts scale with the person.
- **How benglooru.com's people look so good:** their credits page says all their people are the **Microsoft Rocketbox Avatar Library** (MIT, github.com/microsoft/Microsoft-Rocketbox, archived 2 Oct 2026), "rebound to our skeleton, heads swapped, skin, hair and clothes recoloured, logos painted out".
  - What the library has: 115 realistic clothed, rigged avatars, each with hipoly/midpoly/lowpoly/ultralowpoly meshes in one FBX (about 0.6 MB). Textures are uncompressed 2048 px TGA: body, head and opacity colour are about 40 MB per avatar; normals and specular are another 36 MB, not needed.
  - Matching animations: walk, run, stroll, idles, sitting, waving, dancing and talking for men and women (about 1–7 MB each).
  - Candidates for Bengaluru streets: Female_Adult_01, 03, 13, 17 and Male_Adult_06, 08, 09, 16.
  - Plan once the owner OKs the download (about 365 MB): convert in Blender to GLB with 1024 px WebP (about 1 MB each); use the Rocketbox clips natively (Bip01 skeleton) and keep the procedural riding and IK poses mapped to Bip01 bones; recolour clothes per look; drop the Quaternius bodies for street people first, then the player.

## Real weather, new outfits, traffic lights at night (2026-11-20)

- **Real Bengaluru weather.** The owner said "both, stop asking and keep doing".
  - The server asks Open-Meteo (CC BY 4.0, no key) for the game area's current precipitation, weather code and cloud cover (`apps/server/src/weather/openMeteo.ts`, route `/api/weather`, tests).
  - Requests: only the area centre, rounded to about 5 km, cached 10 minutes per place, rate-limited per IP; no identifying header.
  - Mapping: weather codes and mm/h become a 0–1 rain strength (drizzle 0.25, rain 0.4–0.85, thunderstorm 1); cloud cover greys the sky a little even without rain.
  - The game asks every 10 minutes and eases in over about 20 s. The game's own rain spells are used only if the service cannot be reached; `?rain=` still forces it.
  - Credited on screen ("Weather: Open-Meteo.com" next to the OSM credit) and in CREDITS.md.
  - Checked live: Bengaluru was dry with 15 % cloud at 16:15.
- **Outfits** (owner: crop tops etc. for girls; kurtas, jeans etc. for boys).
  - `OUTFITS` gained crop (crop top & jeans), skirt (top & knee skirt), dress (sleeveless), shirt (shirt & jeans) and shorts (tee & shorts). They were added at the end, so saved looks keep their meaning. Tee now comes with jeans.
  - Every outfit stays open to every build (the existing design rule). `USUAL_OUTFITS` makes the street crowd, and a first-time look, wear outfits suited to the build: build 2 mostly crop tops, dresses and skirts; build 1 mostly shirts & jeans, tees, kurtas and shorts.
  - People code: new garment cuts `crop` and `shorts` plus `armless` (`garments.ts`). Body paint masks: `uCrop` (bare midriff), `uArmless`, `uLegs` (trousers, shorts, or bare under a skirt). One pleated skirt builder (`SKIRTS`) serves the kurta, skirt and dress.
  - Denim on jeans: twill ribs, thread colour variation, worn thighs (`uDenim`).
  - The simple fallback avatar draws skirts and shorts as trousers.
- **Traffic at night** (`trafficView.ts`): every nearby vehicle has headlights and red tail lights (glowing points; one lamp on two-wheelers) and a soft beam on the road ahead, stronger on wet roads. That is three extra draw calls in total.
- **Floating roof tanks fixed** (B-030).

## House compound walls with gate lamps (2026-11-20)

- Owner picked "compound walls", an idea from benglooru.com's footage. Built in code (`worldgen/buildings/houseCompounds.ts`, tests in `houseCompounds.test.ts`; geometry `appendHouseWalls` in `compoundMesh.ts`).
- **Which homes:** houses (up to 700 m²) and small flats or generic homes (up to 350 m², 5 floors).
- **The front:** the wall with the front door, or else the side most squarely facing a road within 30 m.
- **The wall:**
  - A 1.45 m plastered wall with a grey coping runs across the free space in front (up to 3.2 m deep, never onto the footpath or road), with side walls back to the house corners.
  - Colours are cream, pale yellow, peach, grey, white or terracotta, seeded per house.
  - Pieces that would run into another building or a road are dropped.
- **The gate:** a 2.6 m opening in front of the door (you can still walk in), between two pillars, each topped by a globe lamp.
- **Lamps:** the glass balls are drawn by the client in one draw call (`addGateLamps` in `worldView.ts`). They glow brighter than white at night (bloom) with small halos that grow in rain.
- **Size and cost:**
  - In the owner's area: 3,090 globe lamps, so about 1,500 houses.
  - Walls are part of the near chunks' building mesh, so they are solid. They come first out of each chunk's triangle budget (`houseWallTriangles`).
  - The whole test area's full-detail total rose by about 85k triangles (the pipeline test bound is now 420k); every chunk stays under its cap.
- **Limits:**
  - Walls are drawn only in near chunks, but the lamps are drawn everywhere, so at night a far-off house can show a small glow without its pillar (fog hides most of it).
  - The map has no plot lines, so walls follow the house's front, not the real plot boundary.
  - The gate is an open gap; there are no gate leaves.

## Real vehicle speeds, better people, lit night streets (2026-11-20)

- **Vehicle performance** (`vehicleSpecs.ts` `tune`, `driveAccel`, `specForModel`; test `vehicleSpecs.test.ts`). The owner: "make the vehicle speed feel real and the top speed also limit it".
  - **Before:** each kind had one setting for all its models, and acceleration was 3–4× too fast (hatchback 0–100 in about 3.7 s).
  - **Now:** every model has its real top speed (a limiter holds it) and its real 0–100 or 0–60 time. The pull is grip-limited off the line, then power-limited, with air drag growing with speed².
  - **Gears:** the drive cuts briefly at each upshift, matched to the engine note (`gearAt` / `gearTop`). Coasting includes air drag.
  - **Top speeds:**
    - own e-scooter 90 (0–60 in 5.5 s); 110 cc scooter 85; Pulsar 150 at 115 (0–60 in 5 s); auto 55;
    - WagonR 150 (0–100 in 13.5 s); Nano 105; Honda City 190 (10.5 s); BMW M3 250 limited (3.9 s);
    - Creta 175; Seltos 170; Thar 155; BMW X3 240 (6.3 s);
    - minivan 140; ambulance 120; pickup 120; trucks and tempo 80; bus 80.
  - These replace the owner's earlier numbers (bike 150, hatchbacks 180, SUVs 200).
- **People** (`people.ts`):
  - **Arms:** slimmed in the rest pose by pulling arm vertices toward the bone line (upper arm up to 14 %, forearm 10 %, blended at the joints; no bone scaling, so nothing shears).
  - **Clothes:** cloth materials have sheen and fabric detail fixed to the cloth: folds at elbows, knees, ankles and waist, torso drape, side seams, waistband and hem, fine weave up close, and fold valleys that shade themselves (bump from screen-space slopes, no textures).
  - **Kurta:** the lower half hangs in pleats.
  - It is still the free Quaternius body. The bigger step, clothed bodies, needs a download (Quaternius' itch.io page refused us with "429 Too Many Requests" today).
- **Night streets:**
  - The map's own street lamps were 25 in the whole area: the old rule only invented lamps when there were fewer than 30 in total. Now ours fill in unless real ones cover 30 % of lit streets, skipping spots within 12 m of a real lamp (`scatter.ts`). The owner's area went from 25 to 1,500 (the cap).
  - Lamp heads glow brighter than white at night, so bloom catches them. Halos (points, so GTAO skips them) grow in rain, and light pools are brighter on wet ground. Measured 10.5–13 ms a frame at night in rain against 10.3 by day.
- **Trees:** rain trees grown 1.55×, gulmohars 1.3× and neems 1.2× (Medium and High), for wide canopies over the avenues.
- **Learned from benglooru.com** ("Namma Benglooru", ideas only):
  - Their demo is built like ours: three.js, Rapier, OpenStreetMap, Quaternius characters, plus ambientCG/Poly Haven textures, EZ-Tree trees, Kenney/Freesound sounds, and real weather from Open-Meteo.
  - Their footage shows a kerb-height golden-hour camera, big avenue trees, compound walls with globe lamps on the gate pillars, black-and-yellow barriers, and glowing lamps and shops reflected on wet roads.
  - We now have the lamps and the trees.
  - Ideas not done yet: compound walls with gate lamps; real weather from Open-Meteo (open data, would need a credit); clothed characters.

## Big AAA pass: day cycle, rain, speed-up, lights, sound, roofs (2026-11-19)

- **Speed (owner: "really laggy").** Measured in the browser pane at 2048×1536 on High: 23 ms per frame. The costs were AO about 12 ms, shadows about 7, bloom about 6 and the cinema pass about 4.
  - High now caps sharpness at 1.5× (`quality.ts`).
  - AO runs at half resolution and bloom at a quarter (wrapped `setSize` in `applyBloom`).
  - Sun shafts use 22 taps and skip pixels far from the sun.
  - The governor softens the picture above 20 ms and sharpens below 14 ms (was 36 / 22).
  - Result: about 11–12 ms in the same view. Not measured on the owner's full-screen window or a phone.
- **Running day** (`cycleHour` in `atmosphere.ts`, test `cycle.test.ts`). The owner now wants time to pass (earlier they wanted a fixed afternoon).
  - Per real minute: 6:00–16:00 runs at 1 game hour, 16:00–19:00 at half an hour (6 minutes of golden hour, sunset and dusk), and 19:00–6:00 at 3 hours (about 4 minutes of night).
  - It comes from `Date.now()`, so everyone sees the same time. The debug slider still overrides it (`hourSlider`).
  - A clock under the minimap shows the time, the part of the day and the weather, with Kannada below (ಬೆಳಗ್ಗೆ / ಮಧ್ಯಾಹ್ನ / ಸಂಜೆ / ರಾತ್ರಿ, ಮಳೆ).
- **Rain and storms** (`atmosphere/weather.ts`):
  - **Schedule:** `rainAt` cuts time into 7-minute spells; about 1 in 3 is rainy (0.45–1), with 90 s fades. Shared by everyone. `?rain=0…1` in the address forces it (Root keeps it on the room address).
  - **Rain:** `RainView` is 7,000 line streaks in a box that follows the camera; drops stay put in the world.
  - **Sky:** the sky, fog and reflections go overcast grey, clouds close in and the sun disc and sun effects disappear. The sun is about 70 % dimmer.
  - **Surfaces:** roads darken and turn glossy, puddles collect with drop rings (`WET_GLSL`), and walls and soil darken.
  - **Storms:** above 0.65 there is lightning (a double flicker lighting the street) and rolling thunder after a delay that grows with distance.
  - **Sound:** rain hiss, muffled indoors. Birds stop.
  - **Tyres:** in the wet they leave few marks and no smoke.
- **Window glass** mirrors the real sky colours, clouds and a skyline of the buildings opposite. Each pane is tilted slightly differently. The reflection is added as light, so shaded walls still have bright windows.
- **Car lamps** (`game/carLights.ts`): red brake lights (brake or handbrake), white reversing lights, and tail and head lamps at night, on the car you drive only.
  - They are glowing points, not sprites: GTAO skips points, while sprites came out as dark squares.
  - `LocalPlayer.brake` is new: `throttle` is never below 0, which had also turned off hard-braking skid marks.
- **Arrival shot:** a 4.5 s drone shot glides down from 55 m to the normal camera. Moving or dragging cuts it short.
- **Loading screen** (`LoadingScreen.tsx`): a dusk skyline, a progress bar that only moves on real stages, and control tips.
- **City sound** (`sound.ts`, all made in code): a traffic hum that swells, distant horns panned left and right, birds by day, wind at speed, rain and thunder. Everything outdoors is muffled indoors. Checked that it runs (4 horns and 2 bird calls in 15 s); nobody has listened to it yet.
- **Roofs:** solar water heaters on about 45 % of homes and flats where they fit (`hasSolarHeater` / `solarSpot`; 16 triangles, counted exactly in the chunk estimate, with a test). The terrace shader adds rain stains, damp green patches, newer waterproofing and tile joints.
- **Street name card** (`StreetBanner.tsx`, `worldgen/areas/streets.ts` `StreetFinder` with a test): "Now on <road>" slides in when you turn onto a named OpenStreetMap road and stay a second. At junctions the wider road wins.
- **Ideas from benglooru.com ("Namma Benglooru", another Bengaluru game; bengalooru.com is a parked domain):** we took only ideas: local Kannada touches, golden hour and rain as the showpiece, and named streets. We did not copy their theatre-marquee branding, flags, tagline, images, footage or code.
- **Button fixes:** "Get out" was under Horn, and "Go inside / Get in" was under Emote. Both now have their own spots.
- **New motorbike (2026-11-19, owner's OK):** Sketchfab "Bajaj pulsar 150" by @ShreyanshChaurasia_12 (CC BY, 2.7 MB download, 14k triangles, 236 KB in the game).
  - Its textures were product photos, including another maker's bike. All were removed (`tools/vehicles/repaint.mjs`) and the SketchUp edge lines dropped.
  - Its three photo-wrapped parts were split by position on the bike (`tools/vehicles/pulsar-regions.mjs`) into tyres, rims, hubs, engine, exhaust, fork, bars, seat, frame and painted body. The body takes each copy's paint.
  - Settings: `turn: Math.PI`; the rider's seat, bars and pegs were re-placed for its 0.79 m seat (`vehicleSpecs.ts`). Checked: it rides forward, and the rider sits on the seat with hands on the bars.
- **Not done:**
  - A better character model needs new downloads and the owner's OK. Candidates: Sketchfab "Bajaj pulsar 150" (CC BY, 14k faces, @ShreyanshChaurasia_12), "pulsar 135 ls" (CC BY, 24k faces), Royal Enfield Classic 350 (CC BY, 733k faces, much too heavy without Blender).
  - Quaternius' Regular (non-superhero) bodies are only in the paid Source pack; the free pack has Superhero bodies only. Our code already narrows them.
  - Traffic cars have no lights at night. Nothing in this pass is tested on a phone.

## Cinema pass: sun shafts, lens flare, speed blur, car reflections (2026-11-19)

- **One "cinema" post pass on High** (`CINEMA_SHADER` in `game.ts`; it replaces the old grade pass and keeps its grade and vignette). Uniforms are set each frame in `updateCinema`.
  - **Sun shafts:** sky brighter than 2.2 (HDR) near the sun is smeared towards it (32 taps with a random offset), so light pours through gaps between buildings. Measured: the sun is about 12, open sky about 0.5.
  - **Lens flare:** five soft coloured rings along the line from the sun through the screen centre, a glow, and a thin horizontal streak. Shown only while the sun disc itself is visible (5 taps at the sun) and in front of you. Fades as the sun leaves the screen or sets, and is off indoors.
  - **Speed blur:** from 90 km/h (full at 260) the picture smears outwards from the centre while the middle stays sharp, and the vignette darkens a little.
  - **Also:** a faint colour fringe in the corners (only when slow) and a very fine moving film grain.
  - **Cost** on the owner's Mac: about 1.5 ms per frame for the sun effects and 0.6 ms for the blur. The whole High post chain was about 15.5 ms at that size.
- **Car reflections** (`atmosphere/cityReflections.ts`): cars used to reflect a white studio room. They now reflect the real sky colours, the sun, a skyline of buildings along the horizon (windows lit at night) and asphalt below. It is rebuilt only when the sun moves or night falls, which means once after loading at the fixed hour. `StreetLifeView.setReflections` hands the new map out.
- **Car paint** (`loadTexturedModel`):
  - The body paint is now a clear-coated `MeshPhysicalMaterial` (a sharp mirror layer over the colour).
  - Glass is smooth. Chrome is real metal. Some models name parts in Portuguese: `vidro` = glass, `cromado` = chrome.
  - These parts reflect 2–2.4× more than tyres and trim (`userData.reflect`).
- **Tyre smoke fixes:** hitting another car no longer counts as hard braking (you must be pressing brake), and a launch makes a light puff instead of a cloud (0.65 → 0.35).
- Not done: a true per-object motion blur (this one smears outwards from the screen centre); volumetric fog. Medium (phones) has none of the cinema pass. Not tested on a phone.

## Skid marks, tyre smoke, sky, HUD, characters (2026-11-19)

- **Skid marks and tyre smoke** (`game/tyreFx.ts`, driven from `game.ts` after the drive hint). Only for the vehicle you drive.
  - How hard the tyres slide (0–1) is the strongest of four things: sideways slip, the handbrake above 4 m/s, hard braking (`longAccel < -6`), or a launch in a fast car.
  - Marks are laid behind each rear tyre (one for bikes). They are one dynamic mesh, a ring buffer of 900 quads (about 300 m of marks); the oldest are replaced first.
  - Smoke is one draw call of up to 220 soft puffs that swell, rise and fade over about 2 s, darker at night.
  - A tyre-squeal noise (`sound.skid`) follows the same amount.
  - Checked in the browser: a short handbrake slide on a motorbike laid 20 mark segments and 30 live puffs, and the smoke is clearly visible. Marks are dark rubber on dark asphalt, so they show best on lighter concrete.
- **Sky** (`atmosphere/sky.ts`): deeper blue at the top, a warm band at the horizon, a brighter sun disc with three layers of glow, thin cirrus streaks, and cumulus clouds that are shaded on the side away from the sun with a bright edge when the sun is behind them.
- **HUD** (`ui.css` "AAA HUD skin", `Speedometer.tsx`):
  - Buttons and the minimap are dark frosted glass with uppercase lettering. Ride is a warm gradient with a glow.
  - The speedometer is bigger and has tick marks, a red zone and a blue → yellow → red needle arc.
  - Cover screen and panels are also restyled.
  - Fixed while doing this: in a street vehicle the "Get out" button sat under the Horn button. It now takes the hidden Ride button's spot, and Drift moves left.
- **Characters** (`player/avatar/people.ts`): a soft cool rim light around everyone's outline, a warm glow at the edges of skin (a cheap stand-in for light passing through skin), and a sheen on hair. Subtle; no new models.
- Not done: motion blur; skid marks for other people's and traffic cars; marks are not saved and disappear when you reload. Not tested on a phone.

## Cinematic pass: light, AO, ledges, haze, road wear (2026-11-19)

- **Lighting** (`atmosphere.ts` LOOKS): day sun 3.2–3.4 (was 2.3–2.6) and warmer; sky fill 1.5–1.6 (was 1.9–2.1) and cooler. Lit walls against shade now read clearly. Fill was briefly 1.25–1.35, but that made tree canopies nearly black.
- **Ambient occlusion** (High only): `GTAOPass` between the render and the bloom in `applyBloom`. Radius 1.6 m, 12 samples, blend 0.9. It adds contact shadows at wall bases and corners and under cars. Measured about 7.5–10 ms per frame on the owner's Mac.
- **Floor ledges and roof cornices** (`buildingMesh.ts` `addLedge`): a 30 cm concrete band at every floor slab (capped at 8) and a 42 cm cornice at the roof, on homes, flats, shops and offices (not glass towers, industrial or floating parts).
  - Built only in near chunks. If a chunk is nearly full (30k triangles), the building is drawn without ledges rather than skipped.
  - Cost: 6 triangles per wall per level. The pipeline test's full-detail cap was raised from 150k to 300k for the whole test area; only chunks near you use full detail.
- **Walls** (facade shader): large patches of faded and darker plaster plus small blotches, and a darker grey plinth at the foot of the wall.
- **Haze:** fog now starts at 15 % of the view distance (was 45 %), and the day horizon is a warmer grey. Distant buildings fade, which gives depth.
- **Roads:** on roads wider than 5.5 m, each 3.3 m lane gets its own wheel tracks and an oil line down its middle. Every road gets sandy dust drifting in along the kerbs and large soft tone patches.
- Not done: the M5 and M4 CSL (need Blender); roof surface detail; skid marks, smoke and motion blur. Medium quality (phones) gets the lighting, ledges, haze, walls and roads, but not the AO or colour-grade pass. Not tested on a phone.

## The owner's square (2026-11-19)

- The owner marked the area they want on a map: from the Outer Ring Road at Ecospace / Sakra hospital (top-left) down to Sarjapur Road (bottom), Bellandur–Doddakannelli–Kadubeesanahalli. The game now always shows exactly that: `GAME_AREA = { lat: 12.922, lng: 77.692 }`, `GAME_HALF_SIZE = 1350` (2.7 km square), in `packages/shared/src/constants.ts`. `Root.tsx` starts there unless the URL has `?lat=&lng=`.
- Inside it: 4,158 buildings, 1,720 road lines, 2.7 km of Outer Ring Road (392 m of flyover), 1.7 km of Sarjapura Road, New Horizon College Road, Kadubeesanahalli Main Road, Gear School Road. Preparing the world takes about 1.4 s on the owner's Mac (was 2.9 s for the 3.6 km map).
- The owner's map picture was only used to see which area they meant; all data is still OpenStreetMap.
- `TEST_AREA` (the old centre) is still used by the debug page and the tests.

## Real Outer Ring Road, modern BMWs (2026-11-17)

- Owner: "dont just add any random expressway, add the real highway which is there near bellandur". The made-up Nukkad Expressway is **removed** (`expressway.ts` deleted).
- **Bigger map:** the real ORR is 1.6 km from the test area's centre, outside the old 1.2 km map. The game now asks for `GAME_HALF_SIZE = 1800` (a 3.6 km square). `DEFAULT_HALF_SIZE` stays 600 for the API and the tests; `MAX_HALF_SIZE` is 1800.
  - The Bellandur pack at 1800: 475 KB gzipped, 6,729 buildings, 2,562 road lines. It has 3.9 km of Outer Ring Road carriageway (both directions, 460 m of flyover) and 5.4 km of Sarjapura Road.
  - First build on the server takes about a minute (Overpass); after that it is cached in `.cache/areas`. In the browser, preparing the world takes about 3 s on the owner's Mac.
  - Network positions are now stored in 6 cm steps (±1966 m; were 2 cm, ±655 m). The server's area limit is 1840 m.
  - Traffic and walker counts scale with the area (up to 420 and 900 routes).
- **Getting on the highway:** it is the real road, so you drive onto it from the real side roads and service roads; its flyover has ramps at both ends. It is the orange road in the north-west of the map (press M).
- **`clearMainRoads`** (`roads/clearRoads.ts`, run in the worker after `decodePack`): removes buildings whose outline contains a main-road centre-line point (2 in this area, e.g. a structure over the ORR) and trees/lamps/benches on the carriageway.
- **Footbridges** (`bridgeRise(along, foot)`): bridges of kind footway/pedestrian/steps/cycleway are now skywalks 5.6 m up with short stair ramps and no pillars in the road. Before, a 1 m-high slab blocked the ORR.
- Test: a BMW M3 followed the ORR's real points at full throttle: 0 → 245 km/h over about 750 m, passing under the footbridge. (The run ended when my coarse test path cut a curve, not because of the road.)
- **Modern BMWs** (CC-BY, in CREDITS.md): `bmw_m3.glb` ("BMW M3 (G80)" by alex20010804, made without logos) replaces the 1998 E46 as the sedan; `bmw_x3.glb` ("2020 BMW X3" by tonielpro520, logo part removed) joins the SUVs. Both take colours (`paint` names their flat paint material) and both needed `back: true`. The X3 has no light version (`NO_LIGHT_MODEL`): the simplifier only got it to 17k triangles.
- `slim.mjs` now also removes parts whose material is named logo/badge/emblem.
- Honest limits: the 3.6 km map is untested on a phone (9× the area: more memory and a longer first load). Rooms made before today were for the 1.2 km map. The X3's front badge area was only checked from a distance. A stray "]" typed into `apps/web/src/world/streamPlan.ts` (not by the assistant) was removed because it broke the build.

## Nukkad Expressway, quiet highways, handling, sound fix (2026-11-15)

- **Nukkad Expressway** (REMOVED on 2026-11-17, replaced by the real Outer Ring Road; kept here as history):
  - What it is: our own elevated 20 m-wide motorway, so there's room to test top speed. It's a straight line across the area with 70 m ramps at both ends and a 6.5 m deck (the usual flyover code, `b: 1`).
  - Where it goes: it tries 16 angles × 5 offsets and keeps the line with the least building height per metre.
  - What it clears: buildings, trees, lamps, benches, compound walls and places within 14 m of its centre line.
  - How it's added: in the world worker straight after `decodePack`, so the server, cache and `PACK_VERSION` are unchanged and every player in the same place gets the same road. It's skipped for areas smaller than 245 m half-size.
  - Test result: a BMW went 0 → 246 km/h in about 12 s over about 750 m, with no traffic in the way.
- **Quiet highways:** traffic routes that would start on a motorway are re-drawn 90 % of the time (trunk and flyovers 75 %, primary 50 %).
- **Handling:**
  - Hitting things keeps the forward part of the speed (×0.97). Grazing walls and kerbs slides on; a head-on hit stops you. The old "×0.6 on any bump" rule is gone.
  - Stability assist: when sliding without the handbrake or steering into it, the car lines up with where it's going.
- **Sound fix:** the engine note fades out by itself if it isn't refreshed within 0.35 s (game frames stopped). The audio context is suspended when the tab is hidden or closed, and resumed when you come back.
- Honest limits:
  - The expressway's two ends just ramp down to the ground. They aren't joined to streets with proper junctions.
  - The deck has only a centre line (no lane lines yet).
  - It clears real buildings in its path.
  - The sound fix was not heard on a real device.

## Handling and speed feel (2026-11-15)

- Owner: "make the handling better and make the speed feel real like in games like FH6". An original arcade feel, no copied assets.
- **Physics** (`LocalPlayer.rideStep`):
  - Power fades towards top speed (`1 − share^2.2`), and lifting off slows you with drag (`0.7 + 2.4·share²` m/s²).
  - Brakes are a little stronger at speed.
  - Steering is quick at low speed and calmer at high speed.
  - The turn is capped by tyre grip: about 12.5 m/s² for cars, 11 for bikes, ×1.6 with the handbrake.
  - Yaw has inertia (weight), sliding scrubs speed (`slip`), and the handbrake still drifts.
- **Body motion:** `bodyPitch` (nose up on the throttle, down on the brakes) and `bodyRoll` (outward in corners, checked) are applied to the car you drive. Bikes keep their lean.
- **Camera** (`game.ts`):
  - The field of view follows real km/h (62° → 82°), plus a kick when you floor it.
  - The camera pulls back when you accelerate and pushes in when you brake (`cameraLag`), sits lower at speed, and swings in faster at speed.
  - Road shake (sine waves, no random jerks) grows with speed and with sliding.
- **Speed lines:** `speedLines.ts`, a half-resolution 2D canvas over the game. They start at 70 km/h and peak at 250.
- **Engine sound:** a simple gearbox (`engineRpm`: 5–6 gears, longer as you go up) makes the note climb and drop at each change. Throttle makes it louder and brighter. Scooters are smooth automatics.
- Honest limits:
  - Only checked by short automated drives. The test streets are narrow, so a full 250 km/h run wasn't done.
  - No skid marks, tyre smoke or real motion blur yet.
  - Not tested on a phone. The speed-lines canvas is cheap, but it's an extra layer.

## More cars, more colours, always day, faster vehicles (2026-11-15)

- **Always day:** `Atmosphere.override` starts at `DAY_HOUR` (16:00) instead of following the real clock (owner: "stop making the time according to the time of the day"). The debug slider still moves it, and setting it to null brings the real clock back.
- **More cars:**
  - Parking now runs every 4–12 m (was 5–26) and skips 12 % of spots (was 35 %). It also uses tertiary streets.
  - The parked mix is more cars and fewer two-wheelers. `MAX_VEHICLES` is 6000. Traffic has 70 routes (was 40) with more cars in the mix.
  - One test area went from fewer to about 3,400 parked vehicles.
- **Light models:**
  - `<car>_lod.glb` is about 3–4k triangles, made with `slim.mjs <car>.glb <car>_lod.glb 3000 0.08` from the cleaned game files, so the logo fixes carry over.
  - The nearest 6 of each type use the full model (`NEAR_FULL`) and the rest use the light one. Shadows and moving traffic use the light one.
- **More colours:**
  - Variants are now 0–63 (were 0–7) in parking and traffic.
  - `CAR_PAINTS` has 26 colours (mostly white, silver and grey). Two-wheelers have 16, bikes 14 and autos 12.
  - The Thar (red window) and Seltos (pale-panel window) now take colours too. Their lights may pick up a little tint.
- **Speeds** (owner's numbers): bike 150 km/h, scooters 90, hatchbacks and taxis 180, SUVs 200, sedans (City, BMW) 250. Acceleration and brakes were raised to match. The server's plausibility limit went from 25 to 75 m/s.
  - The wire format still carries speed in one byte (max 25.5 m/s). That only affects friends' riding animation; positions are exact.
- Honest limits:
  - Not tested on a phone. Medium quality can now show 100+ vehicles, about half of them light versions.
  - Fast driving was only tried briefly (0 to 80 km/h in about 2 s before a wall). The physics was never tested at 250 km/h, so going through thin walls is possible.

## Indian car models (2026-11-15)

- Owner asked for "indian models like fortuner, BMW, scorpio, creta, innova, swift". **No usable free Fortuner, Innova, Swift or Scorpio exists**: on Sketchfab they are GTA-mod rips (BHP3D), spam/re-uploads (David_Holiday, shreyanshchaurasia13, re-uploads of ddiaz-design's non-commercial work) or bare shells. With the owner's OK we use 9 clean CC-BY models instead (CREDITS.md): Honda City, Hyundai Creta, Kia Seltos, Maruti WagonR, Mahindra Thar, Tata Nano, BMW 3 Series (E46), Tata Signa truck, a Tata Ace-style mini-truck.
- Owner was told: real car shapes and names belong to the car makers, so a public release carries some legal risk. All logos, badges, model names and number plates were removed.
- Pipeline (the original downloads are not in the repo):
  1. Heavy models (Creta, Nano, Thar, WagonR) were decimated in Blender (via MCP, in a temporary scene).
  2. `tools/vehicles/slim.mjs` keeps colour textures only (512 px WebP), quantizes the geometry, simplifies, and drops nodes named emblem/logo/badge/shadow plus any names given on the command line.
  3. Logo fixes:
     - Creta: Object_212/214/216/696/702 dropped.
     - Nano: Object_5 dropped; rear chrome faces deleted in Blender.
     - WagonR: lettering islands and the "S" faces (wipers material, UV area 30–120 × 26–90 px) deleted in Blender; textures 2/7/8/11 painted over.
     - BMW: 2 roundels painted over in texture 0.
     - Seltos: logo painted over in texture 1.
     - Tata truck: logo and lettering painted over in texture 1.
     - City: emblem nodes dropped; both plates replaced with KA plates in texture 0.
  4. **Re-running slim.mjs on an original download loses steps 1 and 3**, so redo them.
- Loader fixes this needed:
  - Quantized attributes are turned back into floats before the transform; without this they overflow into crumpled shapes.
  - Material names are kept (`own.name`).
  - `paintMaterial` names the flat paint material, which then simply takes the copy's colour.
  - `paint: null` keeps a model's own colours (Thar, Seltos).
- `back: true` on almost all of them: these models face +z. Every one was checked from the front in the game.
- Kinds: hatchback = WagonR/Nano, sedan = City/BMW, SUV = Creta/Seltos/Thar, taxi = City (white), van = generic minivan, ambulance = generic, truck = Tata Signa (10 m, longer than the old 5 m truck slot, so parked ones may overlap), delivery = mini-truck/generic pickup.
- Honest limits: no Fortuner, Innova, Swift or Scorpio. The Thar and Seltos are always their own colour. Not tested on a phone. About 5.8 MB of car files (loaded only when used).

## Real-looking cars + rider polish (2026-11-15)

- Owner: "make the things which are not perfect perfect and then get good cars". With the owner's OK, 2 free CC-BY packs by comrade1280 were downloaded (credited in CREDITS.md). `tools/vehicles/split.mjs` cuts them into one ~350 KB file per vehicle in `public/models/sketchfab/cars/` (512 px WebP, colour textures only; bodies opaque, decals cut-out, glass see-through). The raw packs are not in the repo.
- `CARS` in streetLifeView.ts: hatchback = hatchback + compact, sedan = sedan + wagon, suv = suv + offroad, taxi = sedan in white, van = minivan, ambulance, truck = garbage truck, delivery = pickup. `back: true` turns a model round. This was checked from the side while driving each one, with forward on the screen's right. The Kenney cars are now only the fallback.
- Colours: `paint: 'auto'` finds the body's main hue from the texture of the part with the most triangles (`findBodyPaint`). Other parts keep their own colours. `CAR_PAINTS` gives Bengaluru-style colours (mostly white and silver). A body with no clear hue (the black SUV) keeps its own colour. Repainted brightness is capped (×1.3) so white cars don't glow.
- Scooters: a second paint area covers the pale panels, so the whole body takes the colour. `BodyPaint` is now a list of up to 2 areas.
- Riders: `leanTo` bends the lower back forward, up to 0.32 rad, until the hands reach the grips. The Driving clip does not reset the spine each frame, so the previous frame's lean is undone first (`spineBefore`); without that it builds up into a hunch. The bike seat moved 8 cm forward. The auto driver now sits on the front seat with their head clear of the roof.
- Honest limits: the cars are generic Western/Japanese shapes, not Indian models (no Swift, Innova and so on). Those on Sketchfab were either ripped from GTA mods or asked for permission. The ambulance and garbage truck are US-style. Not tested on a phone. Loading the cars adds about 4 MB.

## Premade Indian vehicles from Sketchfab (2026-11-14)

- Owner: "its not coming good just use premade". With the owner's OK and their own Sketchfab sign-in, 4 free CC-BY models were downloaded to `apps/web/public/models/sketchfab/` (auto, two_wheeler, motorbike, bus). Credits are in CREDITS.md and **must stay** (CC-BY).
- Changes made to the files: the bus maker's grille badge and both state-transport emblems are painted over; a small script badge on the scooter side panel is painted over; the bike's US number plate is replaced by a plain "KA 01 EK 2611" plate. The bus and scooter textures were re-saved as JPEG (the bus went from 3.6 MB to 0.95 MB).
- `loadTexturedModel(path, fit)` now keeps one material per part (the bus has 5 and the bike has 6), lays the long side along z, and scales to a real length (`SKETCHFAB` table in streetLifeView.ts: auto 2.7 m, scooter 1.8, bike 2.15, bus 11.2; the bike and bus are turned by π). Parked vehicles, traffic, the vehicle you drive and friends' vehicles all use them. Our Blender models are now only the fallback if a file is missing.
- **Colours (same day):** `bodyPaint` in models.ts repaints only texels near each model's body hue (auto teal-green, scooter mint, bike red, bus blue) with the copy's instance colour, keeping the texture's light and dark. Palettes are in `BODY_PAINTS` (streetLifeView.ts); pure white keeps the original. They are used for parked vehicles, traffic and the vehicle you drive. Hue numbers were measured from the textures (`ref` = mean linear brightness of the body texels).
- **Rider (same day):** two-bone IK in people.ts (`reach`) puts the hands on the handlebar and the feet on the footrests. Each vehicle spec has `hands`, `feet` and `seat` ([up, z] shift), and the auto driver now sits on the front seat instead of the passenger bench. Friends' riders use the same values.
- Honest limits: the bus is a Maharashtra bus with Marathi text, not a BMTC bus. The bike is a cruiser style, not a real Bullet. The scooter's cream panels keep their colour (only the mint trim changes). Bus colours only change the blue lower skirt. The auto driver's head is just under the roof, and the hands on the bike and auto stop a few cm short of the grips. Not tested on a phone.

## Vehicles rebuilt from real proportions + a bullet-style bike (2026-11-14)

Owner: "these are the exact same… check the real design… add a bullet bike".
- `tools/blender/vehicles.py` now shapes bodies from **lofted cross-sections** (rounded-rectangle sections along the length, smoothed with subdivision) instead of boxes, plus bent tubes, curved mudguards and wire-spoked wheels.
- **Auto-rickshaw** (2.63 × 1.3 × 1.7 m): tall narrow nose with the headlamp in its face, flat-sided waist-high tub, arched canvas hood with black piping curving down the back, black rexine rear with a window, tube frame, rolled curtains, bench/backrest, handlebar, meter. 12.3k triangles.
- **Scooter** (1.76 m, seat 0.7 m): full leg-shield apron up to the handlebar cowl (headlamp in the cowl), flat floorboard, rear body swelling over the engine down to the wheel, long seat, telescopic fork, mudguard, grab rail, exhaust. 13.9k triangles.
- **Bullet-style motorbike** (generic 350 cc classic, no brand): 19" wire-spoked wheels, teardrop tank with knee pads and a gold pinstripe, round headlamp in a nacelle with a speedo on top, finned barrel leaning forward, crankcase, round toolbox/oil tank, long chrome exhaust and silencer, sprung saddle + pillion, deep mudguards. 15.5k triangles. New vehicle kind `motorbike` (code 13): ~8 % of traffic and ~10 % of parked vehicles, drivable (22 m/s, leans).
- Honest: much closer to the real things, still stylised; triangle counts are 2–3× the first Blender versions — phone cost unmeasured (if heavy, lower the spoke count and subdivision first).

## Blender works: our own vehicle models (2026-11-14)

- Blender MCP is connected (the add-on "MCP" from lab.blender.org had never been installed inside Blender; it auto-starts on port 9876 — no tab). Blender must be open.
- `tools/blender/vehicles.py` builds **our own** auto-rickshaw (6,500 triangles), scooter (3,620) and city bus (6,424) by script: bevelled panels, lathed tyres, arched canvas roof, seats, lamps, mirrors. Run in Blender: `exec(open('<repo>/tools/blender/vehicles.py').read()); build_all('<repo>/apps/web/public/models')` → `auto.glb`, `two_wheeler.glb`, `bus.glb`. No brand marks, blank plates.
- The game prefers these files (`BLENDER_MODELS` in streetLifeView.ts) and falls back to the code-built shapes. Material names matter: "Paint…" takes the per-vehicle colour, "Glass/Chrome/Light…" are glossy.
- Fixed an old bug found on the way: the per-vehicle colour tinted the whole model (the shader replace targeted text inside an #include). Now only paint parts are tinted. Daytime reflection strength lowered (it washed colours out).
- Owner also asked for Unreal Engine and two repos: Unreal = a different engine and a restart, not done (owner chose the web on 2026-11-12). gugu-2/Game-NPC-Brain-LLM (Apache-2.0, local LLM NPC chat server) is usable later, needs a strong machine. casanova77koresh/The-Pinnacle-Of-V looks like a malware lure (no code, only links to an outside "free download" of a GTA V mod) — do NOT use or download.
- Honest: these are clean stylised models, far better than before, but not photoreal AAA; triangle counts are ~6× the old ones (phone cost unmeasured).

## Characters fixed (2026-11-14) — owner: "this character is really weird"

- **Real cloth layers** (`player/avatar/garments.ts`): the shirt/kurta top and trousers are their own skinned meshes cut from the body (by region + height), seams welded, smoothed (Laplacian, rims kept) so muscles and abs vanish, then pushed 1–3 cm off the skin. Shared per build + outfit. Hoodie/jacket stand off more (looser); tee has short sleeves.
- **Kurta skirt**: a flared cloth cone from the waist to the knees riding on the pelvis bone (double-sided). Legs can poke through on wide steps — no cloth simulation.
- **Normal proportions**: chest (spine_03 ×0.88) and middle (spine_02 ×0.94) scaled down with the head and arms scaled back, shoulders 14 % closer — no more bodybuilder V-shape.
- **Natural stance**: the library's idle stands wide-legged with the arms held out ("ready" pose); while standing/talking the thighs are turned in a little and the upper arms are brought down to the sides (0.3 rad). The arm direction was checked in a live test (the opposite turn pushed the arms out); the final look was NOT seen in the game — the browser script tool was blocked and the hidden pane would not finish loading. Owner: please check on screen.
- Owner asked to copy benglooru.com's character style: declined (their characters are their own work); fixed our own pose instead.
- Changing outfit now rebuilds the person (the cloth shape depends on it). Painted clothes stay under the layers in case anything pokes through.
- Not done: loose sleeves, collars, shoes as separate models, real fabric texture.

## Roads, flyovers, full map (2026-11-14)

- **Flyovers and bridges** from OpenStreetMap `bridge=*` (pack flag `b`, PACK_VERSION 13): the road deck rides up on smooth ramps (6.5 m clearance on bridges > 120 m, a small lift on short ones), with a concrete slab, crash barriers with a yellow stripe, and round pillars with flared caps every 24 m (`worldgen/roads/flyover.ts`, in the chunk building mesh → solid). You can walk/drive onto them (the deck is in the road collider mesh). Verified at Silk Board (23 bridges, the double-decker shows as stacked decks). The Bellandur test area has no bridges.
  **Traffic drives on flyovers** (2026-11-14): routes carry a height per point from the same ramp profile as the deck (`bridgeRise`), so cars and bikes ride up the ramps and over the deck; their solid boxes follow, and they only brake for someone on the same level (not for a player under the flyover). Checked at Silk Board: 13 of 40 routes use a flyover; car height matches the deck within ~0.1 m (up to ~0.7 m off on ramps — the deck sits on the higher side of the ground, the car follows the centre). Walkers no longer use bridges at all (decks have no footpath).
  Limits: OSM "layer" is ignored, so the double-decker's levels come only from each way's own ramp profile; ramps can clip where a bridge way is short; no footpaths on decks.
- **Road wear** (road shader): tar patches, potholes with dark floors and crumbling rims, manhole covers every ~45 m, painted yellow-black speed-breakers on small roads (paint only — no bump yet).
- **Full-screen map** (tap the small map or press M): north up, drag to pan, + / − zoom, "Me" recentres; **real street names** from the map (`name:en`/`name`, car roads only, one label per name on its longest piece; small streets show from zoom 1.8), named places (names from zoom 2.4), friends with names, you.
- Realistic Indian vehicles: searched; found only paid, "royalty-free" or AI-generated models — none CC0/CC-BY, so nothing was added.
- Building shapes already use the exact OpenStreetMap outlines; OSM has no data on balconies, roof shapes or facade detail for Bengaluru, so "perfect" real designs are not possible from open data.

## Map and vehicles (2026-11-13) — owner: "make it look like a premium game" (not a clone)

- **Mini-map** (`ui/MiniMap.tsx`, picture painted in the worker by `worldgen/areas/miniMap.ts`): round GPS-style map top-left, turns with the camera, zooms out while driving; roads by importance (main roads orange/yellow), buildings, parks, water; named places as coloured dots, friends as blue dots (on the rim when far), you as an arrow (yellow when inside a building). Redrawn ~15×/s. Phone size 120 px.
- **Five more vehicles** from the Kenney Car Kit we already had (CC0, in CREDITS): taxi, van, ambulance, truck, delivery tempo — parked, in traffic and drivable (codes 8–12; flags still fit in 4 bits). Big vehicles get the heavy horn. Kenney's models are cartoony low-poly; they match our cars, not real Indian makes.
- **Auto-rickshaw and scooter rebuilt in code** with much more detail (see vehicleModels.ts).
- Not done: fire engine/police (left out on purpose for now), sirens, vehicle-specific engine sounds, interiors of vehicles.

## Street life details (2026-11-13) — ideas from looking at benglooru.com, all our own work

The owner asked to use that game's graphics. We did NOT copy or download anything from it (their art, logo, character, missions and "Scene" meter are theirs). We only took the general idea that small street details make a place feel like Bengaluru, and built our own:
- **Overhead wires** (`streetDressing.ts`): three sagging strands between each street-lamp pole and its two nearest poles (9–42 m), one draw call. Wires can cut a corner over a building — not checked.
- **Petal carpets** under gulmohar (red), tabebuia (pink) and bougainvillea (magenta): one instanced flat mesh for the whole area.
- **Shop awnings**: a sloping cloth canopy with a valance over the fronts of shops, restaurants and supermarkets (in the chunk building mesh, 6 triangles each, 8 seeded colours).
- **Kannada on name boards**: every board shows the Kannada word for the kind of place (ಅಂಗಡಿ, ಹೋಟೆಲ್, ಶಾಲೆ …, `PLACE_KANNADA`) above the name. Only 9 of 118 named places in the test area have a real `name:kn` in OpenStreetMap, so real Kannada names are not used yet. The owner should check the words — written by Claude, not by a Kannada speaker.
- **Sound, made in code** (`audio/sound.ts`, Web Audio, no files): horn on H / the Horn button (three voices: scooter & auto, car, bus) and an engine hum that follows speed (a soft whine for your own scooter). Only you hear it — not sent to friends. Starts after the first tap or key press (browser rule). Not listened to by Claude (no speakers here): only checked that the audio graph runs and the horn gain rises.
- Wires, petals, awnings appear on Medium and High (wires/petals) or everywhere (awnings, Kannada).

## Graphics pass (2026-11-13) — owner: "make everything more clear and beautiful"

All made in code or from assets we already had — nothing new was downloaded.
- **Buildings** (`materials.ts`, facade shader v5, zero extra triangles): every window has a frame, sill and sunshade; behind the glass a small room is ray-traced ("interior mapping": back wall, side walls, floor, ceiling, furniture blocks) so rooms shift as you walk past; curtains, office blinds, school grills; apartments get balcony columns (railing, door); shops get lit interiors with shelves, roller shutters (some down) and a coloured sign band; glass towers mirror the sky; sun glints on panes; rain streaks, slab lines, grime; lit rooms at night.
- **Roofs**: a stair room on terraces of buildings ≥ 2 floors, a bigger lift room on large blocks (+10 triangles each). **Paints**: brighter Bengaluru house colours added to the palettes.
- **Trees** (`treeModels.ts`): leaf-card canopies with an inner blob, branches, a leaf atlas painted on a canvas (leaf cluster, palm frond, solid, grass tuft); species: rain tree, ashoka, neem, gulmohar (orange), tabebuia (pink), coconut palm, bush, bougainvillea — picked from the map's tree variant + the tree's own random number. Medium = 60 % of the cards. Low keeps the old 28-triangle trees. Leaf shadows use a cut-out depth material.
- **Ground**: footpaths (1.6 m paved strips both sides of trunk/primary/secondary/tertiary/residential roads ≥ 5 m, near chunks only) with interlocking pavers and kerb stones, yellow-black on main roads; finer two-scale ground grain; lawns shaded with blades and patches; red-earth and damp patches on bare ground; **grass tufts** around the player on lawns (`grassView.ts`, radius 26 m High / 14 m Medium, one draw call); soft shade where buildings meet the ground (blurred footprint mask in the ground map's alpha channel).
- **Sky and light**: drifting clouds; soft shadow filtering; on High a film-style grade (contrast, colour, warm lights/cool shadows, vignette) after bloom; water mirrors the sky and glitters; nights are moonlit blue instead of near-black.
- Measured in the hidden browser pane at the Assetz gate: **Low ≈ 95k triangles / 35 draw calls, Medium ≈ 283k / 78**. Frame rate could NOT be measured here (the pane throttles frames) and nothing was tested on a phone — Medium may be too heavy for a mid-range Android; if so, lower Medium's tree cards or grass radius first.
- Honest: this is a big step up, but still a stylised look, not photoreal AAA. Buildings are still extruded outlines (no real balconies/roof shapes), far (LOD1) buildings have no windows, and characters' clothes are painted on.
- Declined (owner asked 2026-11-13): scraping/cloning another game's graphics (benglooru.com) — against the project's own rules (no ripped or scraped assets) and copyright. Taking ideas from it is fine.

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
