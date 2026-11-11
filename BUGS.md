# Nukkad — BUGS

Running bug log. Fix order: **crash → wrong behaviour → performance → cosmetic**.

Template:

```
### B-000 short title
- Type: crash | wrong behaviour | performance | cosmetic
- Status: open | fixing | fixed (commit) | won't fix in v1
- Found: date, device/browser
- Steps to reproduce:
  1.
- Expected / actual:
- Notes:
```

## Open

### B-001 Towers, domes and other special roofs are drawn as plain blocks
- Type: cosmetic
- Status: open (known v1 limit: flat roofs only)
- Found: 2026-11-10, laptop, built-in browser
- Steps to reproduce:
  1. Open `/debug.html?lat=48.8584&lng=2.2945`
  2. Look at the tall landmark in the middle.
- Expected / actual: a tapering lattice tower / a stack of big boxes with windows.
- Notes: the map describes such shapes with roof types we do not build yet. Normal buildings are fine.

### B-002 Faint lighter patches on lakes
- Type: cosmetic
- Status: open
- Found: 2026-11-10, laptop
- Steps to reproduce:
  1. Open `/debug.html` (test area) and fly to the lake at the east edge.
- Expected / actual: one even water colour / slightly lighter bands near the shore and near the path.
- Notes: the ground is not lowered close to roads, so it touches the water sheet there. Reads as ripples. Fix idea: match the painted ground colour to the lit water colour, or cut the water mesh along the ground grid.

### B-003 Edges of parks and pitches are soft when seen from very close
- Type: cosmetic
- Status: open
- Found: 2026-11-10, laptop
- Steps to reproduce:
  1. Fly down to ground level at the edge of a park.
- Expected / actual: a crisp edge / a blurry edge about 1 m wide.
- Notes: ground colours live in one 1024 × 1024 picture for the whole area (1.2 m per pixel). Cheap and fast; to be judged again in third-person view (Phase 2) and in Phase 5.

### B-004 The game download is bigger than the budget (physics engine)
- Type: performance
- Status: open — fix planned in Phase 3
- Found: 2026-11-11, production build
- Steps to reproduce:
  1. `npm run build` and read the size of `main-*.js`.
- Expected / actual: ≤ 1,200 KB zipped for all code / 1,745 KB, of which ≈ 1,650 KB is the Rapier physics engine.
- Notes: my plan estimated Rapier at ≈ 700 KB; the real WASM is 3.1 MB (1,170 KB zipped) and the "compat" package embeds it as text, which adds another ≈ 480 KB. Fix: load the WASM as its own file and in its own chunk. Even then the total will be ≈ 1.4 MB — still above the budget, to be re-judged with real loading times on the phone.

## Fixed

### B-F01 A browser could reuse a cached pack of an old format after an update
- Type: wrong behaviour
- Status: fixed 2026-11-10 (Phase 1)
- Notes: found while changing the pack format; the page showed "saved by a different version". The pack version is now part of the request address (`&v=2`) and errors are sent with `no-store`. Test: `app.test.ts`.

### B-F02 `npm run dev` started the server on the web page's port in some tools
- Type: crash (dev only)
- Status: fixed 2026-11-10 (Phase 1)
- Notes: a tool had set `PORT=5173` for the whole command. The dev script now always gives the server port 8787 (or `NUKKAD_SERVER_PORT`), and the server exits loudly if it cannot listen.
