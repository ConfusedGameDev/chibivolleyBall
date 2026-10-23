# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Overview

Chibi Volley: arcade 3D volleyball (Three.js + TypeScript + Vite), web first, Capacitor for iOS/Android later. Currently M3: online (Fly.io match server), 1v1/2v2/3v3 vs CPU, 2P couch versus and co-op, Practice (ball launcher). Live at https://chibivolleyball.vercel.app (Vercel project `chibivolleyball`, production = `main`, previews for other branches). The PRD and milestone plan live in a shared doc; milestones are M0 feel prototype → M1 local 1v1 rules/sets → M2 teams + couch → M3 online (authoritative server, Colyseus) → M4 polish + store builds.

## Commands

- `npm run dev` (Vite, `--host` for phone testing), `npm run server` (local match server, ws://localhost:8787), `npm test` (vitest, sim only), `npm run build` (tsc + vite build), `npm run typecheck`
- URL flags: `?play=solo|versus|coop|practice` (skip the menu), `?bot=easy|normal|hard`

## Architecture

- `src/sim/`: the match simulation. **Pure TS: no DOM, no Three.js** — it must stay runnable in Node because bots, tests, and later the game server run it. Fixed step `DT = 1/60`, seeded RNG (`rng.ts`), deterministic for a seed.
  - `constants.ts` all tuning numbers (units: avatar height ≈ 1; net at z = 0; side +1 is z > 0 = local player). Court size depends on team size (`COURTS`, `world.court`); pass `world.court` to `inCourt`/`planHit`.
  - `world.ts` `World.step(inputs)` advances one tick and pushes `SimEvent`s into `world.events` (the client drains them for juice). Phases `serve` → `rally` → `dead` (→ `over` when the match is won). `mode` is `match` (sets: `SET_TO`/`WIN_BY`/`SET_CAP`/`BEST_OF`, `point()` awards a rally) or `practice` (no opponent; `startLaunch()` lobs balls, `drill` events track the return streak). `restart()` starts a new match with the same players.
  - Contacts: jump-push (`tryPush`, also blocks at the net), charged hit on release (`release` → `planHit`). Collisions are against the hand point (`hand()`), not meshes.
  - `physics.ts` ballistic helpers; `planHit` picks target and flight time from charge and clamps until the ball clears the net.
  - `bot.ts` produces the same `Input` a human does (move, hold hit, release in reach); difficulty in `LEVELS`. In teams the teammate closest to the contact point chases; early touches are pushes toward the teammate nearest the net (dig low at `DIG_H`, set at `PUSH_H`), the last is a hit or a jump spike; the rest hold formation (`spot`). Jumping while charging never pushes (spike approach).
  - `team.ts` `pickControl()` auto-switch: a human's control moves to the teammate clearly closer to the incoming ball.
- Online (same design as Super Tennis Deluxo's M6):
  - `server/room.ts` is the whole server game logic (lobby with up to 6 seats and team switching, quick-match auto start, 60 Hz authoritative `World.step`, server-side bots for empty or dropped seats, auto-switch per seat, 20 Hz snapshots, rematch votes, 60 s rejoin). It takes time and send functions as parameters so `src/net/net.test.ts` drives it over a fake laggy network. `server/index.ts` is HTTP `/health` + WebSocket plumbing. The server imports `src/sim` and `src/net/protocol.ts` directly (run with tsx; `server/Dockerfile` copies them). If the server starts importing another `src/` file, add it to the Dockerfile.
  - `src/net/protocol.ts` (messages, `mergeDue`: the one rule both sides use to apply inputs to ticks), `src/net/session.ts` (prediction + reconciliation; every other avatar repeats its last confirmed input; runs one RTT + 3 ticks ahead), `src/net/client.ts` (WebSocket, ping, rejoin).
  - `World.snapshot()` / `load()` / `World.from()` make the world exactly restorable; bots use their own `Rng`, never the world's, so a client predicting without bots stays in step.
  - Fly app `chibi-volley-match` (fly.toml, region dfw, one always-on machine), deployed by `.github/workflows/fly.yml` when `FLY_API_TOKEN` is set.
- `src/render/`: Three.js views of sim state only (`chibi.ts` primitive + GLB avatars, `pet.ts` cube-pet ball, `markers.ts` landing ring/drop line/shadows/charge arc/trail, `fx.ts` particles + comic words, `camera.ts`, `court.ts`, `toon.ts`).
- `src/input/controls.ts` `read(slot, two)` maps keyboard/mouse/touch/gamepads to player slots in screen space.
- `src/render/camera.ts` modes `follow` / `broadcast` / `side` (versus), sized to the court.
- `src/main.ts` boot, `newGame(kind)` (`demo` bot-vs-bot behind the menu, `solo`, `versus`, `coop`, `practice`; team size from settings) with `players` (input slot + controlled avatar + auto-switch); every avatar has a `Bot`, humans override theirs; human stick input is screen-space and goes through `rig.toWorld()`; UI state `menu`/`play`/`paused`/`over` with overlays `#menu`/`#pause`/`#over` (buttons use `data-a` actions, difficulty chips `data-l`), fixed-timestep loop, event → sfx/fx mapping; settings persist in `chibivolley.settings`; `src/ui/hud.ts` DOM HUD; `src/audio.ts` Web Audio synth (no files).
- Models: `public/models/manifest.json` lists GLBs (Kenney Mini Characters, Cube Pets); empty = primitive stand-ins.

Debug hook for browser checks: `window.__cv` (`world`, `state`, `kind`, `phase`, `score`, `sets`, `rally`, `best`, `streak`, `ball`, `me`, `clips`, `models`, `players`, `court`, `cam`, `online`, `act(action)`). URL flags for online: `?server=ws://...`, `?lag=100`, `?room=CODE`.

## Conventions

- Rendering never mutates sim state; anything gameplay-relevant goes in `src/sim` with a test in `sim.test.ts`.
- Compact TS: short names, several statements per line where it stays readable, minimal comments. Match the surrounding style.
- localStorage keys are prefixed `chibivolley.` and always accessed inside try/catch.
