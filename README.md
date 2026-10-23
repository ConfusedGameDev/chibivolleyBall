# Chibi Volley

Arcade 3D volleyball with chibi avatars, built with Three.js for the web and (later) iOS/Android through Capacitor.

Two verbs carry the game: **jump** near the ball to push it up, **hold hit** to charge and **release** in reach to send it over. More charge = faster, flatter, deeper; a charged hit in the air near the net is a spike.

Status: **M0 feel prototype**, 1v1 against a CPU on one device. See the PRD / plan for milestones M1–M4 (rules and sets, teams and couch play, online, ship).

## Run

```sh
npm install
npm run dev        # http://localhost:5173 (also on your LAN for phone testing)
npm test           # sim unit tests (vitest)
npm run build      # typecheck + production build into dist/
```

URL flags: `?demo` (bots on both sides), `?bot=easy|normal|hard`.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Move | WASD / arrows | left-half joystick | left stick |
| Jump / push | Space | jump button | A |
| Hit (hold, release) | J or left mouse | hit button | X / RT |
| Camera preset | C | cam button | Y |
| Assist on/off | P | assist button | |

## Models

Characters (Kenney Mini Characters) and the ball (Kenney Cube Pets) load from `public/models/` — see [public/models/README.md](public/models/README.md). Without them the game uses primitive stand-ins.

Kenney assets are CC0 (kenney.nl).
