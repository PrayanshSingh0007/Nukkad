# Nukkad

**Meet your friends at the corner — in a 3D copy of any real neighbourhood.**

Nukkad turns open map data (OpenStreetMap + open elevation data) into a small 3D world that
friends can walk and ride around in together, from a phone browser, by invite link.

> **Status: Phases 1 and 2 of 7 are done** — the map → 3D pipeline, and walking around in third
> person with your own avatar. Multiplayer, voice, photos and the scooter come next. See `PLAN.md`
> for the whole plan and `NOTES.md` for where things stand right now.

## Run it

You need Node.js 22.18 or newer (24 is what we use).

```bash
npm install
```

```bash
npm run dev:http
```

Then open **http://localhost:5173/** on the laptop: you appear at the street corner nearest the
centre of the test area. Walk with `W A S D`, drag with the mouse to look, and tap **Your look**
to change your avatar. (`/debug.html` is the free-fly viewer with counters.)

**On your phone (same Wi-Fi):** the terminal prints a line like
`Network: http://192.168.x.x:5173/` — open that address. Left thumb moves, right thumb looks.

`npm run dev` (without `:http`) does the same over **https** with a self-signed certificate.
Later phases need https (the microphone only works on https). The phone shows a warning once:
tap *Advanced → Proceed*. It is your own laptop, so that is safe on your home Wi-Fi.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | server + web app over https (phone-ready, mic-ready) |
| `npm run dev:http` | same over plain http (no certificate warning) |
| `npm test` | all automated tests |
| `npm run typecheck` | strict TypeScript check of everything |
| `npm run build` | production build of the web app into `apps/web/dist` |
| `npm run fixture` | re-download the saved map data of the test area (one request to OpenStreetMap — use rarely) |

## Choosing a place (until the place picker exists)

Both pages take the place from the address bar:

- `?lat=12.9207&lng=77.6953` — the place (or type it into the **Place** panel)
- `&r=300` — a smaller area (150–600 m, default 600)
- `&trees=300` — how many trees to draw (default 1000)
- `&windows=0` — plain walls · `&aa=0` — no anti-aliasing · `&pr=1` — lower resolution

Controls — laptop: `W A S D` + drag to look, `E`/`Q` up/down, `Shift` fast, mouse wheel = speed.
Phone: left thumb moves, right thumb looks.

The first visit to a **new** place takes 20–60 seconds: the server asks the free, shared
OpenStreetMap server once, then keeps the result (in `.cache/` during development).

## How the code is organised

```
apps/web        the web app (Vite + TypeScript + Three.js)
apps/server     the server (Express): fetches map data, builds and caches Area Packs
packages/shared code used by both: geometry maths, the Area Pack format
packages/worldgen  pure TypeScript that turns map data into meshes (runs in a web worker, on the server and in tests)
tools/fixtures  saved map data for the built-in test area (works offline)
```

## Settings

Copy `.env.example` to `.env`. Nothing is required for local development.
Never commit `.env`.

## Rules this project never breaks

- Open data only: OpenStreetMap and open elevation tiles. No Google Maps, no Street View, no brand logos.
- The app never asks for a player's real location. "Location" always means the map spot they chose.
- Rooms are invite-only, at most 8 players, and almost nothing about a player is stored.
- Credits for all data and libraries are in `CREDITS.md`.

Deploy instructions arrive with Phase 7.
