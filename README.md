# Chibi Volley

Arcade 3D volleyball with chibi avatars, built with Three.js for the web and (later) iOS/Android through Capacitor.

Two verbs carry the game: **jump** near the ball to push it up, **hold hit** to charge and **release** in reach to send it over. More charge = faster, flatter, deeper; a charged hit in the air near the net is a spike.

Status: **M3**: online play (quick match or room codes, 1v1 to 3v3, CPU bots fill empty slots), 1v1/2v2/3v3 against a CPU (easy / normal / hard), two-player couch versus and co-op on one screen, and Practice with a ball launcher. Sets to 7, win by 2 (cap 11), best of 3. In teams, control follows whoever is under the ball, and CPU teammates dig, set and spike. Next: M4 polish and store builds.

Play it: https://chibivolleyball.vercel.app

## Run

```sh
npm install
npm run dev        # http://localhost:5173 (also on your LAN for phone testing)
npm test           # sim unit tests (vitest)
npm run build      # typecheck + production build into dist/
npm run server     # local match server on ws://localhost:8787 (dev builds connect to it automatically)
```

Online: the client connects to `wss://chibi-volley-match.fly.dev`; `?server=ws://...` picks another server, `?lag=100` adds 100 ms of round trip for netcode testing, `?room=CODE` opens the join screen with that code.

## Match server (Fly.io)

`server/` is a plain `ws` WebSocket server (authoritative 60 Hz sim, 20 Hz snapshots, rooms in memory), run with `tsx` from `server/Dockerfile`, same setup as Super Tennis Deluxo. `.github/workflows/fly.yml` deploys it on pushes to `main` that touch the server or the sim, once the repo secret `FLY_API_TOKEN` is set (`fly tokens create org`); it creates the `chibi-volley-match` app on the first run. Manual deploy: `fly deploy`.

URL flags: `?play=solo|versus|coop|practice` (skip the menu; team size comes from the menu setting), `?bot=easy|normal|hard`.

## Controls

| Action | Keyboard (P1) | Keyboard (P2, couch) | Touch | Gamepad |
| --- | --- | --- | --- | --- |
| Move | WASD (arrows too when solo) | arrows | left-half joystick | left stick |
| Jump / push | Space | Right Ctrl or / | jump button | A |
| Hit (hold, release) | J or left mouse | Right Shift or . | hit button | X / RT |
| Camera preset | C | | cam button | Y |
| Assist on/off | P | | assist button | |
| Pause | Esc | | pause button | Start |

Couch: with two gamepads, pad 1 is P1 and pad 2 is P2; with one pad it goes to P2 and P1 uses the keyboard. Holding hit while you jump is a spike approach (no push).

## Models

Characters (Kenney Mini Characters) and the ball (Kenney Cube Pets) load from `public/models/` — see [public/models/README.md](public/models/README.md). Without them the game uses primitive stand-ins.

Kenney assets are CC0 (kenney.nl).
