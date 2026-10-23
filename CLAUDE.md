# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Overview

Chibi Volley: arcade 3D volleyball (Three.js + TypeScript + Vite), web first, Capacitor for iOS/Android later. Currently the M0 feel prototype: 1v1 vs a CPU on one device. The PRD and milestone plan live in a shared doc; milestones are M0 feel prototype → M1 local 1v1 rules/sets → M2 teams + couch → M3 online (authoritative server, Colyseus) → M4 polish + store builds.

## Commands

- `npm run dev` (Vite, `--host` for phone testing), `npm test` (vitest, sim only), `npm run build` (tsc + vite build), `npm run typecheck`
- URL flags: `?demo` (bots on both sides), `?bot=easy|normal|hard`

## Architecture

- `src/sim/`: the match simulation. **Pure TS: no DOM, no Three.js** — it must stay runnable in Node because bots, tests, and later the game server run it. Fixed step `DT = 1/60`, seeded RNG (`rng.ts`), deterministic for a seed.
  - `constants.ts` all tuning numbers (units: avatar height ≈ 1; net at z = 0; side +1 is z > 0 = local player).
  - `world.ts` `World.step(inputs)` advances one tick and pushes `SimEvent`s into `world.events` (the client drains them for juice). Phases `serve` → `rally` → `dead`.
  - Contacts: jump-push (`tryPush`, also blocks at the net), charged hit on release (`release` → `planHit`). Collisions are against the hand point (`hand()`), not meshes.
  - `physics.ts` ballistic helpers; `planHit` picks target and flight time from charge and clamps until the ball clears the net.
  - `bot.ts` produces the same `Input` a human does (move, hold hit, release in reach); difficulty in `LEVELS`.
- `src/render/`: Three.js views of sim state only (`chibi.ts` primitive + GLB avatars, `pet.ts` cube-pet ball, `markers.ts` landing ring/drop line/shadows/charge arc/trail, `fx.ts` particles + comic words, `camera.ts`, `court.ts`, `toon.ts`).
- `src/input/controls.ts` merges keyboard/mouse/touch/gamepad into one `Input`; screen-up = toward the net = −z.
- `src/main.ts` boot + fixed-timestep loop + event → sfx/fx mapping; `src/ui/hud.ts` DOM HUD; `src/audio.ts` Web Audio synth (no files).
- Models: `public/models/manifest.json` lists GLBs (Kenney Mini Characters, Cube Pets); empty = primitive stand-ins.

Debug hook for browser checks: `window.__cv` (`world`, `phase`, `score`, `rally`, `best`, `ball`, `me`, `clips`, `models`, `start()`).

## Conventions

- Rendering never mutates sim state; anything gameplay-relevant goes in `src/sim` with a test in `sim.test.ts`.
- Compact TS: short names, several statements per line where it stays readable, minimal comments. Match the surrounding style.
- localStorage keys are prefixed `chibivolley.` and always accessed inside try/catch.
